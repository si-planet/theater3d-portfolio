/** Existing local photo selection -> explicit private registration only.
 * The client owns transport/session/ack verification; this view never reads a
 * token, opens a file picker, uploads automatically, or changes local photos.
 */
export function createPrivatePhotoRegistrationUI({container,manager,client=null,getContext=()=>null,getSelected,onConfirmed}={}){
  if(!container?.ownerDocument?.createElement)throw new TypeError('PRIVATE_REGISTRATION_CONTAINER_REQUIRED');
  const doc=container.ownerDocument,node=(tag,text='')=>{const e=doc.createElement(tag);e.textContent=text;return e;};
  const root=node('section');root.className='card private-photo-registration';root.dataset.privatePhotoRegistration='true';
  const heading=node('h2','사진 저장'),note=node('p','브라우저에서 만든 FHD 표시본만 전송·저장합니다. 원본 파일은 변경하지 않으며 원본 정보는 기기에서 제공한 미검증 값입니다. 명시 선택한 공개 좌석은 서버 확인 후 연결하고, 대응이 미확정이면 연결을 보류합니다.');
  const selected=node('p'),actions=node('div'),save=node('button','선택 사진 보관'),check=node('button','저장 결과 확인'),retry=node('button','같은 등록 다시 시도'),cancel=node('button','요청 중단'),status=node('p');
  for(const b of [save,check,retry,cancel])b.type='button';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  note.className='private-photo-policy';selected.className='private-photo-selection';actions.className='private-photo-actions';status.className='private-photo-registration-status';
  const details=node('details'),summary=node('summary','저장 방식 안내');details.className='private-photo-help';details.append(summary,note);
  for(const b of [save,check,retry,cancel])b.className='quiet-button';save.className+=' private-photo-primary';
  actions.append(save,check,retry,cancel);root.append(heading,selected,actions,status,details);container.append(root);
  let disposed=false,active=null,serial=0,lastPhotoId=null;const selection=getSelected??(()=>manager?.getSnapshot()?.selected??null);
  const configured=()=>!!client&&['register','retry','recheck','getState','subscribe'].every(k=>typeof client[k]==='function');
  function say(message,code=''){status.textContent=message;status.dataset.code=code;}
  function clearActive(){serial++;active?.abort.abort();active=null;}
  function state(){try{return configured()?client.getState():{configured:false,authenticated:false};}catch{return{configured:false,authenticated:false};}}
  function sync(){
    if(disposed)return;const s=state();
    if(!s.configured||!s.authenticated){if(active)clearActive();selected.textContent='';lastPhotoId=null;
      save.disabled=check.disabled=retry.disabled=true;check.hidden=retry.hidden=true;cancel.hidden=true;
      say(s.configured?'계정에 로그인한 뒤 사진을 보관할 수 있습니다.':'온라인 사진 보관이 설정되지 않았습니다.',s.configured?'SESSION_REQUIRED':'UNCONFIGURED');return;}
    let photo;try{photo=selection();}catch{photo=null;}
    if(active&&active.photoId!==photo?.id){clearActive();say('선택이 바뀌어 요청을 중단했습니다. 같은 사진의 저장 결과를 확인하세요.','OUTCOME_UNKNOWN');}
    const changed=photo?.id!==lastPhotoId;lastPhotoId=photo?.id??null;
    selected.textContent=photo?String(photo.name||'선택 사진'):'처리가 완료된 사진을 선택하세요.';
    check.hidden=retry.hidden=!photo;
    const ready=!!photo&&photo.processingStatus==='ready'&&photo.metadataStatus!=='loading';
    check.disabled=!ready||!!active;save.disabled=retry.disabled=check.disabled||s.readOnly===true;cancel.hidden=!active;
    if(changed&&!active)say(s.readOnly===true?'새 사진 저장은 준비 중입니다. 기존 등록의 저장 결과는 확인할 수 있습니다.':ready?'저장을 누르면 개인 자료함에 보관합니다.':photo?'사진을 처리하고 있습니다.':'');
  }
  async function run(method){
    sync();if(disposed||active||(method==='recheck'?check.disabled:method==='retry'?retry.disabled:save.disabled))return;let photo,captured;
    try{photo=selection();const result=manager.getReadyAssets(photo.id);if(!result?.ok)throw Error();captured=result.value;}catch{say('사진 처리가 완료되지 않았습니다.','NOT_READY');return;}
    const own=++serial,abort=new AbortController();active={abort,photoId:photo.id};
    say(method==='recheck'?'서버 저장 결과를 확인하고 있습니다.':'사진을 개인 자료함에 보관하고 있습니다. 서버 확인 전에는 완료가 아닙니다.');sync();
    try{
      const context=await getContext(captured,{signal:abort.signal});if(disposed||serial!==own||abort.signal.aborted)return;
      const result=await client[method](captured,{context,signal:abort.signal});if(disposed||serial!==own||abort.signal.aborted)return;
      if(result?.ok===true&&result.confirmed===true){
        say(result.contextStatus==='resolved'?'FHD 표시본 저장과 선택한 좌석 연결을 확인했습니다.':'FHD 표시본 저장을 확인했습니다. 좌석 연결은 미확정 상태로 유지합니다.','SAVED_PRIVATE');
        if(typeof onConfirmed==='function'){try{await onConfirmed();}catch{if(!disposed&&serial===own&&!abort.signal.aborted)say('FHD 표시본 저장은 확인했지만 자료함 갱신을 확인하지 못했습니다. 자료함에서 다시 시도하세요.','SAVED_REFRESH_FAILED');}}
      }else if(result?.code==='OUTCOME_UNKNOWN'||result?.uncertain){say('저장 결과가 아직 확인되지 않았습니다. 같은 등록의 결과를 확인한 뒤 다시 시도하세요.',result?.code||'OUTCOME_UNKNOWN');}
      else{const labels={NOT_FOUND:'이 등록의 서버 저장 기록을 찾지 못했습니다. 같은 등록을 다시 시도할 수 있습니다.',CONTENT_CHANGED:'처음 등록을 요청한 내용과 달라졌습니다. 원본과 기존 등록은 유지했습니다.',SESSION_REQUIRED:'로그인 상태를 확인하세요.',ACCESS_DENIED:'이 계정으로 사진을 보관할 수 없습니다.',NOT_READY:'사진 처리가 완료되지 않았습니다.',UNSUPPORTED_LOCAL_ID:'이 로컬 사진의 식별자는 온라인 등록에서 지원하지 않습니다.',LIMIT_EXCEEDED:'등록 가능한 용량 또는 크기 한도를 초과했습니다.'};
        say(labels[result?.code]||'사진 보관을 확인하지 못했습니다. 원본은 유지했습니다.',result?.code||'REGISTRATION_FAILED');}
    }catch{if(!disposed&&serial===own)say('등록 결과를 확인하지 못했습니다. 원본은 유지했습니다.','REGISTRATION_FAILED');}
    finally{if(serial===own){active=null;sync();}}
  }
  const saveAction=()=>{void run('register');},checkAction=()=>{void run('recheck');},retryAction=()=>{void run('retry');},cancelAction=()=>{clearActive();say('요청을 중단했습니다. 서버 저장 여부는 같은 사진의 결과 확인으로 점검하세요.','OUTCOME_UNKNOWN');sync();};
  save.addEventListener('click',saveAction);check.addEventListener('click',checkAction);retry.addEventListener('click',retryAction);cancel.addEventListener('click',cancelAction);
  const off=configured()?client.subscribe(sync):()=>{};sync();
  return Object.freeze({sync,dispose(){if(disposed)return;disposed=true;clearActive();if(typeof off==='function')off();
    save.removeEventListener('click',saveAction);check.removeEventListener('click',checkAction);retry.removeEventListener('click',retryAction);cancel.removeEventListener('click',cancelAction);
    selected.textContent='';status.textContent='';root.remove();}});
}
