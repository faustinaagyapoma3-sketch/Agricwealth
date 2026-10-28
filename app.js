
// Configure these public frontend values. Never put a Paystack secret or Supabase service-role key here.
const SUPABASE_URL = 'https://zfhwfasifobxjpnevwzo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4bAI-XyR8TFMwNJqit8xOg_iTlJxm5I';
const API_BASE = 'https://YOUR-RENDER-SERVICE.onrender.com';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let session = null, currentView = 'home', authMode = 'login', selectedMethod = 'mtn_momo', adminSection = 'withdrawals';

const $ = id => document.getElementById(id);
const money = n => 'GH₵ ' + Number(n || 0).toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2});
const toast = msg => { const el=$('toast'); el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),4200); };
async function api(path, options={}) {
  if (!session?.access_token) throw new Error('Please sign in first.');
  const r = await fetch(API_BASE + path, { ...options, headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+session.access_token, ...(options.headers||{}) }});
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error || 'Request failed.');
  return j;
}
function showView(view) {
  currentView=view;
  ['authView','dashboardView','walletView','profileView','projectsView','adminView'].forEach(id=>$(id).classList.add('hidden'));
  const map={home:'dashboardView',wallet:'walletView',profile:'profileView',projects:'projectsView',admin:'adminView'};
  if(!session) $('authView').classList.remove('hidden'); else $(map[view]||'dashboardView').classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view));
  if(session) {
    if(view==='home') refreshDashboard().catch(e=>toast(e.message));
    if(view==='wallet') refreshWallet().catch(e=>toast(e.message));
    if(view==='profile') refreshProfile().catch(e=>toast(e.message));
    if(view==='projects') loadProjects().catch(e=>toast(e.message));
    if(view==='admin') loadAdmin(adminSection).catch(e=>toast(e.message));
  }
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=> {
  const v=b.dataset.view;
  if(v==='deposit'||v==='withdraw'){showView('wallet');setWalletTab(v);}
  else showView(v);
}));
function setAuthMode(mode) {
  authMode=mode; $('authTitle').textContent=mode==='signup'?'Create your account':'Welcome back';
  $('authSubtitle').textContent=mode==='signup'?'Register to manage your account.':'Sign in to manage your account.';
  $('nameLabel').classList.toggle('hidden',mode!=='signup');
  $('authSubmit').textContent=mode==='signup'?'Create account':'Sign in';
  $('switchText').textContent=mode==='signup'?'Already registered?':'New here?';
  $('switchAuth').textContent=mode==='signup'?'Sign in':'Create account';
  $('forgot').classList.toggle('hidden',mode==='signup');
}
$('switchAuth').addEventListener('click',()=>setAuthMode(authMode==='login'?'signup':'login'));
$('authForm').addEventListener('submit',async e=>{
  e.preventDefault(); const email=$('email').value.trim(),password=$('password').value;
  try {
    if(authMode==='signup'){
      const full_name=$('fullName').value.trim();
      if(full_name.length<2) throw new Error('Enter your full name.');
      const {data,error}=await sb.auth.signUp({email,password,options:{data:{full_name}}});
      if(error) throw error;
      if(!data.session){toast('Account created. Check your email to confirm, then sign in.');setAuthMode('login');return;}
      session=data.session;
    } else {
      const {data,error}=await sb.auth.signInWithPassword({email,password});
      if(error) throw error; session=data.session;
    }
    toast('Signed in successfully.'); showView('home');
  } catch(err){toast(err.message||'Authentication failed.');}
});
$('forgot').addEventListener('click',async()=>{
  const email=$('email').value.trim(); if(!email)return toast('Enter your email address first.');
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.href});
  toast(error?error.message:'If the address is registered, a password recovery email will be sent.');
});
$('signOut').addEventListener('click',async()=>{await sb.auth.signOut();session=null;showView('home');toast('Signed out.');});
async function refreshDashboard(){
  const [me,tx,projects]=await Promise.all([api('/api/me'),api('/api/transactions'),api('/api/projects')]);
  const w=me.wallet||{}; $('headerBalance').textContent=money(w.available_balance); $('walletBalance').textContent=money(w.available_balance); $('reservedLabel').textContent='Reserved: '+money(w.reserved_balance);
  $('profileName').textContent=me.profile?.full_name||me.user?.email||'Your profile'; $('profileEmail').textContent=me.user?.email||'';
  const recent=(tx.transactions||[]).slice(0,3);
  $('activityList').innerHTML=recent.length?recent.map(t=>`<div class="activity-item"><span class="activity-arrow">${t.direction==='credit'?'↓':'↑'}</span><div class="activity-meta"><strong>${escapeHtml(t.description||t.entry_type)}</strong><small>${escapeHtml(t.status)} • ${new Date(t.created_at).toLocaleString()}</small></div><div class="activity-amount">${t.direction==='credit'?'+':'−'}${money(t.amount)}</div></div>`).join(''):'<div class="empty-state">No verified transactions yet. Your real activity will appear here.</div>';
  $('profitValue').textContent=money((tx.transactions||[]).filter(t=>t.entry_type==='admin_adjustment'&&t.direction==='credit').reduce((a,t)=>a+Number(t.amount),0));
  $('investedValue').textContent=money((tx.transactions||[]).filter(t=>t.entry_type==='investment_allocation').reduce((a,t)=>a+Number(t.amount),0));
  $('joinedCount').textContent='Your account'; $('paidTotal').textContent='Verified only';
  renderProjects(projects.projects||[]);
}
function renderProjects(projects){
  const html=projects.map(p=>`<article class="project-card"><div class="project-photo ${p.slug==='poultry-starter'?'poultry':p.slug==='boer-goat'?'goats':'cow'}"></div><div class="project-content"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p><span class="range">${money(p.min_amount)}–${money(p.max_amount)}</span><p class="tiny">No return is promised. Project-specific contracts and risks must be reviewed before accepting investments.</p></div></article>`).join('');
  $('projectsPageList').innerHTML=html||'<div class="empty-state">No published projects.</div>';
  // Homepage cards use their static safe descriptions until projects load.
}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function refreshWallet(){
  const [me,wds]=await Promise.all([api('/api/wallet'),api('/api/withdrawals')]);
  $('headerBalance').textContent=money(me.wallet.available_balance);$('walletBalance').textContent=money(me.wallet.available_balance);$('reservedLabel').textContent='Reserved: '+money(me.wallet.reserved_balance);
  renderWithdrawals(wds.withdrawals||[]);
}
function setWalletTab(tab){
  const dep=tab==='deposit';$('depositPane').classList.toggle('hidden',!dep);$('withdrawPane').classList.toggle('hidden',dep);
  $('depositTab').classList.toggle('active',dep);$('withdrawTab').classList.toggle('active',!dep);
  document.querySelectorAll('.action-tile').forEach(x=>x.classList.toggle('selected',x.dataset.view===tab));
}
$('depositTab').addEventListener('click',()=>setWalletTab('deposit'));$('withdrawTab').addEventListener('click',()=>setWalletTab('withdraw'));
document.querySelectorAll('.method').forEach(b=>b.addEventListener('click',()=>{selectedMethod=b.dataset.method;document.querySelectorAll('.method').forEach(x=>x.classList.toggle('selected',x===b));$('bankNameWrap').classList.toggle('hidden',selectedMethod!=='bank');$('payoutNumber').placeholder=selectedMethod==='bank'?'Bank account number':'0XXXXXXXXX';}));
$('depositForm').addEventListener('submit',async e=>{
  e.preventDefault(); const amount=Number($('depositAmount').value);
  try { const r=await api('/api/deposits/initialize',{method:'POST',body:JSON.stringify({amount})}); location.href=r.authorization_url; }
  catch(err){toast(err.message);}
});
async function verifyReturnedPayment(){
  const params=new URLSearchParams(location.search);
  if(params.get('payment')==='return'&&params.get('reference')){
    try{const r=await api('/api/deposits/verify/'+encodeURIComponent(params.get('reference')));toast(r.message||'Payment status checked.');history.replaceState({},'',location.pathname);showView('wallet');}
    catch(e){toast('Payment status: '+e.message+' Keep your Paystack reference for support.');}
  }
}
$('withdrawForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const body={amount:Number($('withdrawAmount').value),method:selectedMethod,account_number:$('payoutNumber').value.trim(),account_name:$('payoutName').value.trim(),bank_name:$('bankName').value.trim()};
  try{const r=await api('/api/withdrawals',{method:'POST',body:JSON.stringify(body)});toast(r.message||'Withdrawal request submitted.');$('withdrawForm').reset();await refreshWallet();}
  catch(err){toast(err.message);}
});
function renderWithdrawals(rows){
  $('withdrawalList').innerHTML=rows.length?rows.map(w=>`<div class="list-row"><div><b>${money(w.amount)} · ${escapeHtml(w.method.replace('_',' '))}</b><p class="tiny">${escapeHtml(w.account_name)} • ${new Date(w.created_at).toLocaleString()}</p>${w.payout_reference?`<p class="tiny">Payout reference: ${escapeHtml(w.payout_reference)}</p>`:''}</div><span class="status ${escapeHtml(w.status)}">${escapeHtml(w.status)}</span></div>`).join(''):'<div class="empty-state">No withdrawal requests yet.</div>';
}
async function refreshProfile(){
 const r=await api('/api/me');$('profileName').textContent=r.profile?.full_name||'Your profile';$('profileEmail').textContent=r.user?.email||'';$('profileFullName').value=r.profile?.full_name||'';$('profilePhone').value=r.profile?.phone||'';
 const adminBtn=document.getElementById('adminShortcut');
 if(r.profile?.role==='admin'&&!adminBtn){const b=document.createElement('button');b.id='adminShortcut';b.className='outline full';b.textContent='Open admin console';b.onclick=()=>showView('admin');document.querySelector('#profileView .form-card').appendChild(b);}
}
$('saveProfile').addEventListener('click',async()=>{
 try{
   const {error}=await sb.from('profiles').update({full_name:$('profileFullName').value.trim(),phone:$('profilePhone').value.trim()}).eq('id',(await sb.auth.getUser()).data.user.id);
   if(error)throw error;toast('Profile saved.');
 }catch(e){toast(e.message||'Could not save profile.');}
});
$('supportBtn').addEventListener('click',()=>toast('Configure your real support email or WhatsApp link before launch.'));
$('notifications').addEventListener('click',()=>toast('Notifications will appear when enabled by the backend.'));
$('messages').addEventListener('click',()=>toast('Configure a verified support channel before launch.'));
async function loadProjects(){const r=await api('/api/projects');renderProjects(r.projects||[]);}
document.querySelectorAll('[data-admin]').forEach(b=>b.addEventListener('click',()=>{adminSection=b.dataset.admin;document.querySelectorAll('[data-admin]').forEach(x=>x.classList.toggle('active',x===b));loadAdmin(adminSection).catch(e=>toast(e.message));}));
async function loadAdmin(section){
 const r=await api(section==='withdrawals'?'/api/admin/withdrawals':section==='deposits'?'/api/admin/deposits':'/api/admin/audit-logs');
 if(section==='withdrawals'){
 $('adminContent').innerHTML=(r.withdrawals||[]).map(w=>`<div class="list-row"><div><b>${money(w.amount)} · ${escapeHtml(w.method)}</b><p class="tiny">${escapeHtml(w.account_name)} / ${escapeHtml(w.account_number)} ${escapeHtml(w.bank_name||'')}</p><p class="tiny">${escapeHtml(w.status)} · ${new Date(w.created_at).toLocaleString()}</p><input class="admin-input" id="ref-${w.id}" placeholder="Real payout reference"><input class="admin-input" id="note-${w.id}" placeholder="Admin note"><div><button class="admin-action" onclick="adminAction('${w.id}','approve')">Approve</button><button class="admin-action" onclick="adminAction('${w.id}','complete')">Record paid</button><button class="admin-action danger" onclick="adminAction('${w.id}','reject')">Reject</button></div></div></div>`).join('')||'<div class="empty-state">No withdrawal requests.</div>';
 } else if(section==='deposits') {
 $('adminContent').innerHTML=(r.deposits||[]).map(d=>`<div class="list-row"><div><b>${money(d.amount)} · ${escapeHtml(d.status)}</b><p class="tiny">${escapeHtml(d.reference)} · ${new Date(d.created_at).toLocaleString()}</p></div><span class="status ${escapeHtml(d.status)}">${escapeHtml(d.status)}</span></div>`).join('')||'<div class="empty-state">No deposits.</div>';
 } else {
 $('adminContent').innerHTML=(r.logs||[]).map(l=>`<div class="list-row"><div><b>${escapeHtml(l.action)}</b><p class="tiny">${escapeHtml(l.entity_type)} ${escapeHtml(l.entity_id)} · ${new Date(l.created_at).toLocaleString()}</p><p class="tiny">${escapeHtml(JSON.stringify(l.details))}</p></div></div>`).join('')||'<div class="empty-state">No audit logs.</div>';
 }
}
window.adminAction=async(id,action)=>{
 try{
   if(action==='approve'){await api(`/api/admin/withdrawals/${id}/approve`,{method:'POST',body:JSON.stringify({note:$('note-'+id).value})});toast('Withdrawal approved. Send payment through your real payout channel, then record the receipt.');}
   if(action==='complete'){const ref=$('ref-'+id).value.trim();if(ref.length<4)throw new Error('Enter the real payout reference.');await api(`/api/admin/withdrawals/${id}/complete`,{method:'POST',body:JSON.stringify({payout_reference:ref})});toast('Real payout reference recorded.');}
   if(action==='reject'){await api(`/api/admin/withdrawals/${id}/reject`,{method:'POST',body:JSON.stringify({note:$('note-'+id).value||'Rejected by admin'})});toast('Withdrawal rejected; reserved funds released.');}
   loadAdmin('withdrawals');
 }catch(e){toast(e.message);}
};
sb.auth.onAuthStateChange((_event,s)=>{session=s; if(s){showView('home');verifyReturnedPayment();}else showView('home');});
(async()=>{const {data}=await sb.auth.getSession();session=data.session;if(session){showView('home');verifyReturnedPayment();}else showView('home');})();
