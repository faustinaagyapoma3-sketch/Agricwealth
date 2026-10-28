
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.use(helmet());

const origins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origins.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed'));
  }
}));

app.use(express.json({ limit: '100kb' }));

app.use(rateLimit({
  windowMs: 60000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false
}));

if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_ANON_KEY ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.PAYSTACK_SECRET_KEY
) {
  console.error('Required environment variables are missing.');
}

const adminDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const publicDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const round = n => Math.round(Number(n) * 100) / 100;

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';

    if (!h.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Sign in required.' });
    }

    const { data, error } = await publicDb.auth.getUser(h.slice(7));

    if (error || !data.user) {
      return res.status(401).json({
        error: 'Session expired. Sign in again.'
      });
    }

    req.user = data.user;
    return next();
  } catch (e) {
    return res.status(500).json({ error: 'Authentication failed.' });
  }
}

async function admin(req, res, next) {
  try {
    const { data, error } = await adminDb
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (error || data?.role !== 'admin') {
      return res.status(403).json({
        error: 'Administrator access required.'
      });
    }

    return next();
  } catch (e) {
    return res.status(500).json({ error: 'Admin check failed.' });
  }
}

async function audit(actor, action, type, id, details = {}) {
  const { error } = await adminDb
    .from('audit_logs')
    .insert({
      actor_id: actor,
      action,
      entity_type: type,
      entity_id: String(id || ''),
      details
    });

  if (error) {
    console.error('Audit log failed:', error.message);
  }
}

async function verifyPaystack(ref) {
  const response = await fetch(
    'https://api.paystack.co/transaction/verify/' +
      encodeURIComponent(ref),
    {
      headers: {
        Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY
      }
    }
  );

  const result = await response.json();

  if (!response.ok || !result.status || !result.data) {
    throw new Error('Paystack verification failed.');
  }

  return result.data;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/me', auth, async (req, res) => {
  const [p, w] = await Promise.all([
    adminDb
      .from('profiles')
      .select('id,full_name,phone,role,created_at')
      .eq('id', req.user.id)
      .single(),

    adminDb
      .from('wallets')
      .select('available_balance,reserved_balance,currency')
      .eq('user_id', req.user.id)
      .single()
  ]);

  if (p.error || w.error) {
    return res.status(500).json({
      error: 'Account setup incomplete. Check the Supabase setup.'
    });
  }

  return res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      phone: req.user.phone
    },
    profile: p.data,
    wallet: w.data
  });
});

app.get('/api/wallet', auth, async (req, res) => {
  const { data, error } = await adminDb
    .from('wallets')
    .select('*')
    .eq('user_id', req.user.id)
    .single();

  if (error) {
    return res.status(500).json({ error: 'Unable to load wallet.' });
  }

  return res.json({ wallet: data });
});

app.get('/api/transactions', auth, async (req, res) => {
  const { data, error } = await adminDb
    .from('ledger_entries')
    .select('id,entry_type,amount,currency,direction,status,reference,description,created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return res.status(500).json({
      error: 'Unable to load transactions.'
    });
  }

  return res.json({ transactions: data || [] });
});

app.get('/api/projects', async (req, res) => {
  const { data, error } = await adminDb
    .from('investment_projects')
    .select('id,slug,name,category,description,min_amount,max_amount,duration_days')
    .eq('published', true)
    .order('created_at');

  if (error) {
    return res.status(500).json({ error: 'Unable to load projects.' });
  }

  return res.json({ projects: data || [] });
});

/* ---------------- DEPOSIT INITIALIZATION ---------------- */

app.post('/api/deposits/initialize', auth, async (req, res) => {
  try {
    const amount = round(req.body.amount);

    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
      return res.status(400).json({
        error: 'Enter an amount between GH₵1 and GH₵100,000.'
      });
    }

    if (!req.user.email) {
      return res.status(400).json({
        error: 'A verified email address is required for checkout.'
      });
    }

    const reference =
      'AGRI_' +
      req.user.id.slice(0, 8) +
      '_' +
      Date.now() +
      '_' +
      crypto.randomBytes(4).toString('hex');

    const { error: insertError } = await adminDb
      .from('deposits')
      .insert({
        user_id: req.user.id,
        amount,
        reference,
        status: 'pending'
      });

    if (insertError) {
      console.error('Deposit insert failed:', insertError.message);
      return res.status(500).json({
        error: 'Could not create deposit record.'
      });
    }

    const response = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: req.user.email,
          amount: Math.round(amount * 100),
          currency: 'GHS',
          reference,
          callback_url: process.env.PAYSTACK_CALLBACK_URL,
          metadata: {
            user_id: req.user.id,
            deposit_reference: reference
          }
        })
      }
    );

    const result = await response.json();

    if (!response.ok || !result.status || !result.data?.authorization_url) {
      await adminDb
        .from('deposits')
        .update({ status: 'failed' })
        .eq('reference', reference)
        .eq('status', 'pending');

      return res.status(502).json({
        error: result.message || 'Paystack checkout could not start.'
      });
    }

    await audit(
      req.user.id,
      'deposit_initialized',
      'deposit',
      reference,
      { amount, currency: 'GHS' }
    );

    return res.json({
      authorization_url: result.data.authorization_url,
      reference
    });
  } catch (e) {
    console.error('Deposit initialization failed:', e.message);
    return res.status(502).json({
      error: 'Unable to start payment. Please try again.'
    });
  }
});

/* ---------------- DEPOSIT VERIFICATION ---------------- */

app.get('/api/deposits/verify/:reference', auth, async (req, res) => {
  const ref = String(req.params.reference || '');

  try {
    const { data: deposit, error: findError } = await adminDb
      .from('deposits')
      .select('*')
      .eq('reference', ref)
      .eq('user_id', req.user.id)
      .single();

    if (findError || !deposit) {
      return res.status(404).json({
        error: 'Deposit reference not found.'
      });
    }

    if (!['pending', 'success'].includes(deposit.status)) {
      return res.status(400).json({
        error: 'This deposit cannot be verified. Contact support if you paid.'
      });
    }

    /*
     * Always verify with Paystack, including retries.
     * Never trust a browser redirect alone as proof of payment.
     */
    const payment = await verifyPaystack(ref);
    const amount = Number(payment.amount) / 100;

    if (
      payment.status !== 'success' ||
      payment.currency !== 'GHS' ||
      payment.reference !== ref ||
      !Number.isFinite(amount) ||
      Math.abs(amount - Number(deposit.amount)) > 0.001
    ) {
      return res.status(400).json({
        error: 'Payment amount, currency or reference did not match.'
      });
    }

    /*
     * Change pending to success only after Paystack confirms payment.
     * If another request has already changed it, the RPC below is still
     * called. The database credit function must safely handle retries.
     */
    if (deposit.status === 'pending') {
      const { error: updateError } = await adminDb
        .from('deposits')
        .update({
          status: 'success',
          verified_at: new Date().toISOString(),
          paystack_reference: ref
        })
        .eq('id', deposit.id)
        .eq('status', 'pending');

      if (updateError) {
        console.error('Deposit status update failed:', updateError.message);

        return res.status(500).json({
          error: 'Payment was verified, but its record could not be updated. Retry verification or contact support.'
        });
      }
    }

    /*
     * The RPC is idempotent: a previously credited reference should
     * not credit the wallet twice. A failed RPC can be retried.
     */
    const { error: creditError } = await adminDb.rpc(
      'credit_verified_deposit',
      {
        p_user_id: req.user.id,
        p_amount: amount,
        p_reference: ref,
        p_description: 'Verified Paystack deposit'
      }
    );

    if (creditError) {
      console.error('Deposit credit failed:', creditError.message);

      await audit(
        req.user.id,
        'deposit_credit_reconciliation_required',
        'deposit',
        deposit.id,
        {
          reference: ref,
          amount,
          error: creditError.message
        }
      );

      return res.status(500).json({
        error: 'Payment is verified, but wallet credit could not be confirmed. Retry verification or contact support with your reference.'
      });
    }

    await audit(
      req.user.id,
      'deposit_verified_and_credited',
      'deposit',
      deposit.id,
      { reference: ref, amount }
    );

    return res.json({
      status: 'success',
      message: 'Payment verified and wallet credit confirmed.'
    });
  } catch (e) {
    console.error('Deposit verification error:', e.message);

    return res.status(502).json({
      error: 'Unable to verify the payment right now. Please try again.'
    });
  }
});

/* ---------------- WITHDRAWALS ---------------- */

app.post('/api/withdrawals', auth, async (req, res) => {
  const amount = round(req.body.amount);
  const method = String(req.body.method || '');
  const account_name = String(req.body.account_name || '').trim().slice(0, 120);
  const account_number = String(req.body.account_number || '').trim().slice(0, 80);
  const bank_name = String(req.body.bank_name || '').trim().slice(0, 120);

  if (
    !Number.isFinite(amount) ||
    amount < 1 ||
    amount > 100000 ||
    !['mtn_momo', 'telecel_cash', 'at_money', 'bank'].includes(method) ||
    account_name.length < 2 ||
    account_number.length < 5 ||
    (method === 'bank' && !bank_name)
  ) {
    return res.status(400).json({
      error: 'Check withdrawal amount and payout details.'
    });
  }

  const { data, error } = await adminDb.rpc('request_withdrawal', {
    p_user_id: req.user.id,
    p_amount: amount,
    p_method: method,
    p_account_name: account_name,
    p_account_number: account_number,
    p_bank_name: bank_name || null
  });

  if (error) {
    console.error('Withdrawal request failed:', error.message);
    return res.status(400).json({
      error: error.message || 'Unable to submit withdrawal.'
    });
  }

  await audit(
    req.user.id,
    'withdrawal_requested',
    'withdrawal',
    data?.id || '',
    { amount, method }
  );

  return res.json({
    withdrawal: data,
    message: 'Withdrawal submitted for manual review. Funds are reserved while it is reviewed.'
  });
});

app.get('/api/withdrawals', auth, async (req, res) => {
  const { data, error } = await adminDb
    .from('withdrawals')
    .select('id,amount,currency,method,account_name,account_number,bank_name,status,payout_reference,admin_note,created_at,completed_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return res.status(500).json({
      error: 'Unable to load withdrawals.'
    });
  }

  return res.json({ withdrawals: data || [] });
});

/* ---------------- ADMIN SUMMARY ---------------- */

app.get('/api/admin/summary', auth, admin, async (req, res) => {
  const [
    { count: users, error: usersError },
    { data: deposits, error: depositsError },
    { data: withdrawals, error: withdrawalsError }
  ] = await Promise.all([
    adminDb
      .from('profiles')
      .select('*', { count: 'exact', head: true }),

    adminDb
      .from('deposits')
      .select('amount,status,created_at')
      .order('created_at', { ascending: false })
      .limit(200),

    adminDb
      .from('withdrawals')
      .select('amount,status,created_at')
      .order('created_at', { ascending: false })
      .limit(200)
  ]);

  if (usersError || depositsError || withdrawalsError) {
    return res.status(500).json({
      error: 'Unable to load admin summary.'
    });
  }

  return res.json({
    users: users || 0,
    deposits: deposits || [],
    withdrawals: withdrawals || []
  });
});

app.get('/api/admin/withdrawals', auth, admin, async (req, res) => {
  const { data, error } = await adminDb
    .from('withdrawals')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    return res.status(500).json({
      error: 'Unable to load withdrawals.'
    });
  }

  return res.json({ withdrawals: data || [] });
});

/* ---------------- ADMIN APPROVE WITHDRAWAL ---------------- */

app.post('/api/admin/withdrawals/:id/approve', auth, admin, async (req, res) => {
  const note = String(
    req.body.note || 'Approved for manual payout'
  ).trim().slice(0, 500);

  const { data, error } = await adminDb
    .from('withdrawals')
    .update({
      status: 'approved',
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
      admin_note: note
    })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select()
    .single();

  if (error || !data) {
    return res.status(400).json({
      error: 'Withdrawal is not pending or could not be approved.'
    });
  }

  await audit(
    req.user.id,
    'withdrawal_approved',
    'withdrawal',
    data.id,
    { note: data.admin_note }
  );

  return res.json({ withdrawal: data });
});

/* ---------------- ADMIN COMPLETE WITHDRAWAL ---------------- */

app.post('/api/admin/withdrawals/:id/complete', auth, admin, async (req, res) => {
  const payoutReference = String(
    req.body.payout_reference || ''
  ).trim().slice(0, 160);

  if (payoutReference.length < 4) {
    return res.status(400).json({
      error: 'Enter the real payout receipt/reference.'
    });
  }

  const { data: withdrawal, error: findError } = await adminDb
    .from('withdrawals')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (
    findError ||
    !withdrawal ||
    !['approved', 'pending'].includes(withdrawal.status)
  ) {
    return res.status(400).json({
      error: 'Withdrawal must be pending or approved.'
    });
  }

  const { data, error } = await adminDb.rpc(
    'complete_manual_withdrawal',
    {
      p_withdrawal_id: withdrawal.id,
      p_admin_id: req.user.id,
      p_payout_reference: payoutReference
    }
  );

  if (error) {
    return res.status(400).json({
      error: error.message || 'Could not record payout.'
    });
  }

  await audit(
    req.user.id,
    'manual_withdrawal_completed',
    'withdrawal',
    withdrawal.id,
    { payout_reference: payoutReference }
  );

  return res.json({
    withdrawal: data,
    message: 'Manual payout reference recorded.'
  });
});

/* ---------------- ADMIN REJECT WITHDRAWAL ---------------- */

app.post('/api/admin/withdrawals/:id/reject', auth, admin, async (req, res) => {
  const note = String(
    req.body.note || 'Rejected by administrator'
  ).trim().slice(0, 500);

  const { data, error } = await adminDb.rpc(
    'reject_withdrawal_release_funds',
    {
      p_withdrawal_id: req.params.id,
      p_admin_id: req.user.id,
      p_note: note
    }
  );

  if (error) {
    return res.status(400).json({
      error: error.message || 'Could not reject withdrawal.'
    });
  }

  await audit(
    req.user.id,
    'withdrawal_rejected',
    'withdrawal',
    req.params.id,
    { note }
  );

  return res.json({ withdrawal: data });
});

/* ---------------- ADMIN DEPOSITS ---------------- */

app.get('/api/admin/deposits', auth, admin, async (req, res) => {
  const { data, error } = await adminDb
    .from('deposits')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return res.status(500).json({
      error: 'Unable to load deposits.'
    });
  }

  return res.json({ deposits: data || [] });
});

/* ---------------- ADMIN AUDIT LOGS ---------------- */

app.get('/api/admin/audit-logs', auth, admin, async (req, res) => {
  const { data, error } = await adminDb
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return res.status(500).json({
      error: 'Unable to load audit logs.'
    });
  }

  return res.json({ logs: data || [] });
});

/* ---------------- START SERVER ---------------- */

const port = Number(process.env.PORT) || 10000;

app.listen(port, () => {
  console.log('AgriHarvest API ready on port ' + port);
});
