/** Only allowlisted guidance reaches the UI. Never show server error text. */
export function privateAccountErrorMessage(code) {
  const messages = {
    AUTH_REJECTED: '인증 서버가 로그인을 거절했습니다. 입력 정보 또는 서비스 설정의 추가 확인이 필요합니다. [AUTH_REJECTED]',
    INVALID_CREDENTIALS: '로그인 정보가 일치하지 않습니다. TD에 등록된 이메일과 앱용 비밀번호를 확인하세요. [INVALID_CREDENTIALS]',
    EMAIL_CONFIRMATION_REQUIRED: '이메일 인증이 필요합니다. 가입할 때 받은 인증 메일을 확인하세요. [EMAIL_CONFIRMATION_REQUIRED]',
    ACCOUNT_RESTRICTED: '계정의 로그인이 제한되어 있습니다. 반복 시도하지 말고 계정 상태를 확인해야 합니다. [ACCOUNT_RESTRICTED]',
    CAPTCHA_REQUIRED: '추가 보안 확인을 완료하지 못했습니다. 서비스의 보안 확인 연결을 점검해야 합니다. [CAPTCHA_REQUIRED]',
    INPUT_INVALID: '이메일 형식과 비밀번호 입력을 확인하세요. [INPUT_INVALID]',
    CREDENTIALS_REQUIRED: '이메일과 비밀번호를 입력하세요. [CREDENTIALS_REQUIRED]',
    UNCONFIGURED: '로그인 연결이 준비되지 않았습니다. 서비스 설정을 확인해야 합니다. [UNCONFIGURED]',
    INVALID_CONFIGURATION: '로그인 연결 설정에 문제가 있습니다. 서비스 설정을 확인해야 합니다. [INVALID_CONFIGURATION]',
    RATE_LIMITED: '로그인 요청이 많습니다. 잠시 기다린 뒤 다시 시도하세요. [RATE_LIMITED]',
    TIMEOUT: '서버 응답이 늦어지고 있습니다. 연결 상태를 확인한 뒤 다시 시도하세요. [TIMEOUT]',
    REQUEST_FAILED: '서버에 연결하지 못했습니다. 네트워크와 서비스 상태를 확인하세요. [REQUEST_FAILED]',
    INVALID_RESPONSE: '서버 응답을 확인하지 못했습니다. 서비스 연결 설정을 확인해야 합니다. [INVALID_RESPONSE]',
    SESSION_REQUIRED: '로그인 상태를 유지하지 못했습니다. 다시 로그인하세요. [SESSION_REQUIRED]',
    SESSION_CHANGED: '로그인 상태가 변경됐습니다. 다시 로그인하세요. [SESSION_CHANGED]',
    SESSION_EXPIRED: '로그인이 만료됐습니다. 다시 로그인하세요. [SESSION_EXPIRED]',
    LOGOUT_UNCONFIRMED: '이 화면에서는 로그아웃됐지만 서버의 로그아웃 처리를 확인하지 못했습니다. [LOGOUT_UNCONFIRMED]',
  };
  return Object.hasOwn(messages, code) ? messages[code] : '계정 연결을 완료하지 못했습니다. 잠시 후 다시 시도하세요. [CONNECTION_FAILED]';
}

/** Existing-account login. Credentials remain memory-only; /admin is not security. */
export function createPrivateAdminRoute({window,document,panel,returnButton}={}) {
  if(!window||!document||!panel||!returnButton)throw new TypeError('INVALID_CONFIGURATION');
  const listeners=new Set();let disposed=false;
  const isAdmin=()=>false; // Public synthetic demo: admin routes are not available.
  function sync(){if(disposed)return;const admin=isAdmin();panel.hidden=!admin;panel.inert=!admin;document.body.dataset.accountRoute=admin?'admin':'main';
    if(admin)document.querySelectorAll?.('dialog[open]').forEach(dialog=>dialog.close('account-route'));
    if(!admin)panel.querySelectorAll?.('input[type="password"]').forEach(input=>{input.value='';});
    for(const listener of listeners)listener();}
  function main(){window.history.pushState(null,'',new URL('../',import.meta.url).pathname);sync();}
  returnButton.addEventListener('click',main);window.addEventListener('popstate',sync);sync();
  return Object.freeze({isAdmin,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},dispose(){disposed=true;listeners.clear();returnButton.removeEventListener('click',main);window.removeEventListener('popstate',sync);}});
}

export function createPrivateHostedControls({ container, host, verifyAccess, isActive=()=>true, subscribeActive=()=>()=>{} } = {}) {
  if (!container || !host || typeof host.login !== 'function' || typeof host.logout !== 'function') throw new TypeError('INVALID_CONFIGURATION');
  const root=document.createElement('section');root.className='card private-account-card';
  const heading=document.createElement('h2');heading.textContent='계정으로 로그인';root.append(heading);
  const form=document.createElement('form');
  const emailLabel=document.createElement('label');emailLabel.textContent='이메일';
  const email=document.createElement('input');email.type='email';email.autocomplete='username';email.required=true;email.name='email';email.spellcheck=false;email.setAttribute('autocapitalize','none');emailLabel.append(email);
  const passwordLabel=document.createElement('label');passwordLabel.textContent='비밀번호';
  const password=document.createElement('input');password.type='password';password.autocomplete='current-password';password.required=true;password.name='password';passwordLabel.append(password);
  const login=document.createElement('button');login.type='submit';login.textContent='로그인';login.className='private-account-submit';
  const logout=document.createElement('button');logout.type='button';logout.textContent='로그아웃';
  const status=document.createElement('p');status.className='private-account-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  form.append(emailLabel,passwordLabel,login,logout);root.append(form,status);container.prepend(root);
  let busy=false,disposed=false,generation=0,permissionSerial=0,permissionKey=null,permission='signed-out';
  const session=()=>host.sessionPort?.getSession?.()??null;
  const key=()=>{const s=session();return s?JSON.stringify([s.projectRef,s.accountId,s.epoch]):null;};
  function render(){const signed=!!session();emailLabel.hidden=signed;passwordLabel.hidden=signed;login.hidden=signed;logout.hidden=!signed;
    login.disabled=busy;logout.disabled=busy;email.disabled=busy;password.disabled=busy;login.textContent=busy?'계정 연결 확인 중…':'로그인';form.setAttribute('aria-busy',String(busy));root.dataset.permissionState=permission;}
  async function verify(){
    if(disposed||!isActive())return;const current=key();
    if(!current){permissionKey=null;permission='signed-out';status.textContent='기존 계정으로 로그인하면 비공개 자료 접근 권한을 확인합니다.';render();return;}
    if(current===permissionKey&&['pending','verified'].includes(permission)){render();return;}
    permissionKey=current;permission='pending';status.textContent='로그인됨 · 비공개 자료 접근 권한 확인 중';render();const own=++permissionSerial;
    try{const ok=typeof verifyAccess==='function'&&await verifyAccess()===true;
      if(disposed||own!==permissionSerial||current!==key())return;
      permission=ok?'verified':'denied';status.textContent=ok?'비공개 자료 접근 권한이 확인됐습니다. 메인 화면에서 자료를 볼 수 있습니다.':'비공개 자료 접근 권한을 확인하지 못했습니다.';
    }catch{if(disposed||own!==permissionSerial)return;permission='denied';status.textContent='비공개 자료 접근 권한을 확인하지 못했습니다. 계정 또는 연결 상태를 확인하세요.';}
    render();
  }
  function changed(){permissionSerial++;permissionKey=null;permission=session()?'pending':'signed-out';password.value='';render();void verify();}
  async function run(action){if(busy||disposed||!isActive())return;busy=true;const own=++generation;render();status.textContent='계정 연결을 확인하고 있습니다.';
    try{const result=await action();if(disposed||own!==generation)return;
      if(result?.ok===false){permission='denied';status.textContent=privateAccountErrorMessage(result.code);}
      else if(host.sessionPort){permissionKey=null;await verify();}
      else status.textContent='계정 연결 결과를 적용했습니다.';
    }catch{if(!disposed&&own===generation){permission='denied';status.textContent='계정 연결을 완료하지 못했습니다. 다시 시도해 주세요.';}}
    finally{if(!disposed&&own===generation){busy=false;render();}}
  }
  const submit=event=>{event.preventDefault();if(busy||disposed||!isActive())return;
    if(!email.value.trim()||!password.value){status.textContent='이메일과 비밀번호를 입력하세요.';return;}
    let credentials={email:email.value.trim(),password:password.value};password.value='';
    void run(()=>{const pending=host.login(credentials);credentials=null;return pending;});};
  const signout=()=>{password.value='';void run(()=>host.logout());};
  form.addEventListener('submit',submit);logout.addEventListener('click',signout);
  const off=host.sessionPort?.subscribeSession?.(changed)??(()=>{});
  const offActive=subscribeActive(()=>{if(!isActive())password.value='';else void verify();});
  status.textContent='기존 계정으로 로그인하면 비공개 자료 접근 권한을 확인합니다.';render();void verify();
  return Object.freeze({dispose(){if(disposed)return;disposed=true;generation++;permissionSerial++;off();offActive();password.value='';email.value='';form.removeEventListener('submit',submit);logout.removeEventListener('click',signout);root.remove();}});
}
