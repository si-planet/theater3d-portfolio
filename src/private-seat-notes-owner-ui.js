import { prepareSeatPostScope } from './private-seat-notes.js';
import { normalizeSeatMediaContext,seatMediaContextKey } from './seat-media-context.js';
/** Distinct account-private area. Never imports, reads or publishes local notes. */
export function createOwnedSeatNotes({container,getContext,connection,idPrefix='',getBrowserDraft=null}){
 const doc=container.ownerDocument,section=doc.createElement('section');section.className='seat-notes';const make=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e;};
 const label=make('label','계정 개인 의견'),input=make('textarea'),read=make('button','계정 의견 읽기'),save=make('button','계정에 저장'),clear=make('button','계정 의견 내용 삭제'),importDraft=make('button','브라우저 의견 가져오기'),status=make('p');
 input.id=(idPrefix?idPrefix+'-':'')+'account-seat-opinion';label.htmlFor=input.id;input.rows=3;input.maxLength=2000;
 for(const b of [read,save,clear,importDraft]){b.type='button';b.className='quiet-button';}status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.className='small-note';
 const recovery=make('div'),serverLabel=make('p'),serverValue=make('textarea'),adopt=make('button','서버 현재 값 채택'),retry=make('button','현재 초안으로 재시도 준비');
 serverValue.readOnly=true;serverValue.rows=3;serverValue.setAttribute('aria-label','확인한 서버 현재 의견');for(const b of [adopt,retry]){b.type='button';b.className='quiet-button';}recovery.hidden=true;recovery.append(serverLabel,serverValue,adopt,retry);
 section.append(label,input,read,save,clear,importDraft,status,recovery);container.append(section);let alive=true,epoch=0,busy=false,key=null,mapping=null,account=null,sourceStamp=Symbol('initial');const drafts=new Map();
 const session=()=>{try{return connection.client.getSession();}catch{return null;}};
 const accountKey=s=>s?JSON.stringify([s.projectRef,s.accountId,s.epoch]):null;
 const draft=()=>drafts.get(key);
 function remember(){if(key&&draft())draft().text=input.value;}
 function controls(){const d=draft(),disabled=!key||busy||!connection.client.enabled;input.disabled=disabled;save.disabled=disabled||!!d?.unknown;read.disabled=busy||!account||!connection.client.enabled;clear.disabled=disabled||!d?.id||!!d?.unknown;importDraft.disabled=disabled||typeof getBrowserDraft!=='function';
  recovery.hidden=!d?.unknown||!d?.resolution;const note=d?.resolution?.note;serverLabel.textContent=recovery.hidden?'':note?`확인한 서버 현재 값 · revision ${note.revision}`:'확인한 서버에는 이 좌석의 계정 의견이 없습니다.';serverValue.value=recovery.hidden?'':note?.opinion??'';
  adopt.disabled=disabled||recovery.hidden;retry.disabled=disabled||recovery.hidden||(!note&&d?.pendingRequest?.action!=='create');
 }
 function resetPending(d){d.unknown=false;d.pending=null;d.pendingRequest=null;d.pendingDraftText=null;d.resolution=null;}
 function acceptResolution(useServer){if(!alive||busy||!key||!draft()?.unknown||!draft()?.resolution||accountKey(session())!==account)return;remember();const d=draft(),note=d.resolution.note,pending=d.pendingRequest;
  if(!useServer&&!note&&pending?.action!=='create')return;
  d.id=note?.id??null;d.revision=note?.revision??null;d.newId=!useServer&&!note&&pending?.action==='create'?pending.id:null;
  if(useServer){d.text=note?.opinion??'';input.value=d.text;}resetPending(d);controls();status.textContent=useServer?'확인한 서버 현재 값을 채택했습니다. 저장 요청은 보내지 않았습니다.':'현재 초안을 유지했습니다. 계정에 저장을 누르면 확인한 서버 revision으로 시도합니다. 서버에 글이 없으면 기존 요청 ID를 유지합니다.';
 }

 function fail(code){status.textContent=({SESSION_REQUIRED:'로그인하면 계정 개인 의견을 사용할 수 있습니다.',UNCONFIGURED:'계정 의견 연결이 아직 설정되지 않았습니다.',SEAT_MAPPING_UNAVAILABLE:'이 좌석의 서버 연결이 확정되지 않았습니다.',OUTCOME_UNKNOWN:'저장 결과가 불명확합니다. 계정 의견 읽기로 확인해 주세요. 초안은 유지됩니다.',REVISION_CONFLICT:'다른 기기에서 바뀐 글입니다. 계정 의견을 다시 읽어 주세요.',CONFLICT_RETRY_REQUIRED:'동시 변경이 있습니다. 계정 의견을 다시 읽어 주세요.',DUPLICATE_CONFLICT:'이미 저장된 계정 의견이 있습니다. 먼저 읽고 확인해 주세요.'})[code]||'요청을 완료하지 못했습니다. 초안은 유지했습니다.';}
 function sourceKey(){try{const c=getContext();if(c?.kind==='source2d'){const n=normalizeSeatMediaContext(c);return n?seatMediaContextKey(n):null;}return JSON.stringify([c?.venueId??null,c?.layoutVersionId??null,c?.modelId??null,c?.modelVersion??null,c?.seat?.row??null,c?.seat?.number??null]);}catch{return null;}}
 async function sync(force=false){if(!alive)return;const s=session(),a=accountKey(s),stamp=sourceKey();if(!force&&a===account&&stamp===sourceStamp)return;
  remember();const token=++epoch;sourceStamp=stamp;busy=false;key=null;mapping=null;input.value='';
  if(a!==account){drafts.clear();account=a;}controls();if(!s){fail(connection.client.enabled?'SESSION_REQUIRED':'UNCONFIGURED');return;}
  let selected;try{selected=await connection.getSelection();}catch{selected=null;}
  if(!alive||token!==epoch||accountKey(session())!==a)return;const resolved=selected?prepareSeatPostScope(selected):null;
  if(resolved?.status!=='resolved'){fail('SEAT_MAPPING_UNAVAILABLE');return;}mapping=selected;key=a+JSON.stringify(resolved.scope);
  if(!drafts.has(key))drafts.set(key,{text:'',id:null,revision:null,newId:null,unknown:false,pending:null,pendingRequest:null,pendingDraftText:null,resolution:null});input.value=draft().text;controls();
  let seat;try{seat=getContext()?.seatLabel;}catch{}label.textContent=seat?`${seat} · 계정 개인 의견`:'계정 개인 의견';status.textContent='이 계정에서만 읽는 별도 의견입니다. 기존 브라우저 의견을 자동으로 옮기지 않습니다.';
 }
 async function load(){if(!alive||busy)return;if(!key){await sync(true);if(!key||busy)return;}remember();const token=epoch,a=account,keyAt=key,d=draft(),selected=mapping;if(d.unknown)d.resolution=null;busy=true;controls();let result;
  try{result=await connection.client.read(selected);}catch{result={ok:false,code:'REQUEST_FAILED'};}
  if(!alive||token!==epoch||key!==keyAt||accountKey(session())!==a)return;busy=false;if(!result.ok){fail(result.code);controls();return;}
  const note=result.note;
  if(d.unknown){const pending=d.pendingRequest,wanted=pending?.action==='clear'?null:pending?.opinion;
   const matches=pending&&note&&note.id===pending.id&&note.opinion===wanted&&(pending.action==='create'?note.revision===1:note.revision===pending.expectedRevision||note.revision===pending.expectedRevision+1);
   if(matches){const unchangedDraft=d.text===d.pendingDraftText;d.id=note.id;d.revision=note.revision;d.newId=null;if(unchangedDraft){d.text=note.opinion??'';input.value=d.text;}resetPending(d);status.textContent='이전 저장 결과를 확인했습니다. 이후 작성한 초안은 유지했습니다.';}
   else{d.resolution=Object.freeze({note:note?Object.freeze({id:note.id,revision:note.revision,opinion:note.opinion}):null});status.textContent='서버 현재 값과 이전 요청이 다릅니다. 현재 값을 채택하거나 초안의 재시도 준비를 선택해 주세요. 자동 저장하지 않습니다.';}
  }else{d.id=note?.id??null;d.revision=note?.revision??null;if(!d.text){d.text=note?.opinion??'';input.value=d.text;}status.textContent=note?'계정 의견을 읽었습니다. 작성 중인 초안은 유지했습니다.':'저장된 계정 의견이 없습니다.';}controls();
 }
 async function write(erase=false){if(!alive||!key||busy)return;remember();const d=draft();if(d.unknown){fail('OUTCOME_UNKNOWN');return;}const token=epoch,a=account,keyAt=key,selected=mapping;
  let action,args;try{if(erase||d.text===''){if(!d.id){status.textContent='지울 계정 의견이 없습니다.';return;}action='clear';args={id:d.id,expectedRevision:d.revision};}
   else if(d.id){action='update';args={id:d.id,expectedRevision:d.revision,opinion:d.text};}
   else{action='create';if(!d.newId)d.newId=connection.client.createDraftId();args={id:d.newId,opinion:d.text};}}
  catch{fail('INPUT_INVALID');return;}d.unknown=true;d.pending=action;d.pendingRequest=Object.freeze({action,...args});d.pendingDraftText=d.text;d.resolution=null;busy=true;controls();let result;
  try{result=await connection.client[action]({...selected,...args});}catch{result={ok:false,code:'OUTCOME_UNKNOWN'};}
  if(!alive||token!==epoch||key!==keyAt||accountKey(session())!==a)return;busy=false;
  if(!result.ok){d.unknown=result.code==='OUTCOME_UNKNOWN';if(!d.unknown)resetPending(d);fail(result.code);controls();return;}
  d.id=result.note.id;d.revision=result.note.revision;d.text=result.note.opinion??'';resetPending(d);d.newId=null;input.value=d.text;status.textContent=action==='clear'?'계정 의견 내용만 지웠습니다.':'계정에 저장했습니다.';controls();
 }
 adopt.addEventListener('click',()=>acceptResolution(true));retry.addEventListener('click',()=>acceptResolution(false));
 input.addEventListener('input',remember);read.addEventListener('click',load);save.addEventListener('click',()=>write());clear.addEventListener('click',()=>write(true));
 importDraft.addEventListener('click',async()=>{if(!alive||!key||busy||typeof getBrowserDraft!=='function')return;const token=epoch,a=account,k=key;
  let local,latest,again;try{local=getBrowserDraft();latest=await connection.getSelection();again=getBrowserDraft();}catch{return;}
  if(!alive||token!==epoch||key!==k||accountKey(session())!==a)return;
  const resolved=latest?prepareSeatPostScope(latest):null;
  if(!local||!again||local.contextKey!==again.contextKey||local.text!==again.text||typeof local.text!=='string'||resolved?.status!=='resolved'||a+JSON.stringify(resolved.scope)!==k){status.textContent='좌석이나 브라우저 의견이 바뀌었습니다. 다시 확인해 주세요.';return;}
  remember();if(draft().text&&draft().text!==local.text){status.textContent='계정 초안이 있습니다. 초안을 비운 뒤 가져와 주세요.';return;}
  draft().text=local.text;input.value=local.text;status.textContent='브라우저 의견을 계정 초안에 복사했습니다. 계정에 저장을 눌러야 전송됩니다.';
 });
 const unsubscribe=connection.client.subscribeSession(()=>{if(!alive)return;if(accountKey(session())===account){void sync();return;}drafts.clear();key=null;mapping=null;account=null;sourceStamp=Symbol('session');input.value='';epoch++;void sync();});
 void sync();return {sync,destroy(){if(!alive)return;alive=false;epoch++;drafts.clear();input.value='';serverValue.value='';recovery.hidden=true;if(typeof unsubscribe==='function')unsubscribe();section.remove();}};
}
