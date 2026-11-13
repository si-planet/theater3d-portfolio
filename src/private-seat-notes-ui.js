import { prepareSeatPostScope } from './private-seat-notes.js';
const message=code=>({UNCONFIGURED:'서버 의견 저장이 아직 설정되지 않았습니다.',POLICY_UNCONFIGURED:'서버 의견 저장이 아직 설정되지 않았습니다.',
 SEAT_MAPPING_UNAVAILABLE:'이 좌석의 서버 연결이 아직 확정되지 않았습니다. 입력 내용은 유지됩니다.',AUTHENTICATION_FAILED:'글 비밀번호를 확인해 주세요.',
 REVISION_CONFLICT:'다른 곳에서 글이 바뀌었습니다. 목록을 새로 읽고 확인해 주세요.',OUTCOME_UNKNOWN:'저장 결과를 확인하지 못했습니다. 먼저 목록을 새로 읽어 확인하세요. 초안은 유지됩니다.',
 RATE_LIMITED:'잠시 뒤 다시 시도해 주세요. 초안은 유지됩니다.',UNREPRESENTABLE_TEXT:'저장할 수 없는 제어문자가 있습니다. 입력 내용은 유지됩니다.',
 INPUT_INVALID:'의견과 비밀번호를 확인해 주세요. 의견은 2,000자까지 저장할 수 있습니다.'})[code]||'요청을 완료하지 못했습니다. 초안을 유지했습니다. 다시 확인해 주세요.';
/** Hosted mode is a separate path: it never reads/imports localStorage notes. */
export function createHostedSeatNotes({container,getContext,idPrefix='',hosted}){
 const doc=container.ownerDocument,section=doc.createElement('section');section.className='seat-notes';
 const make=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e;};
 const label=make('label','좌석 공개 의견'),input=make('textarea'),password=make('input'),save=make('button','공개 의견 등록'),clear=make('button','선택 글 내용 삭제'),fresh=make('button','새 의견'),refresh=make('button','목록 새로 읽기'),more=make('button','더 보기'),list=make('div'),status=make('p');
 input.id=idPrefix?`${idPrefix}-seat-opinion`:'seat-opinion';label.htmlFor=input.id;input.rows=3;input.maxLength=2000;
 password.type='password';password.autocomplete='off';password.setAttribute('aria-label','글 비밀번호');password.placeholder='이 글의 수정·삭제용 비밀번호';
 for(const button of [save,clear,fresh,refresh,more]){button.type='button';button.className='quiet-button';}
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.className='small-note';
 section.append(label,input,password,save,clear,fresh,refresh,list,more,status);container.append(section);
 const drafts=new Map();let key=null,selection=null,alive=true,epoch=0,busy=false,cursor=null,items=[];
 function readSelection(){try{const value=hosted.getSelection();const mapped=prepareSeatPostScope(value);return mapped.status==='resolved'?{value,key:JSON.stringify(mapped.scope)}:null;}catch{return null;}}
 function draft(){if(!drafts.has(key))drafts.set(key,{text:'',id:null,revision:null,newId:null,unknown:false});return drafts.get(key);}
 function remember(){if(key)draft().text=input.value;}
 function controls(){const configured=hosted.client?.enabled===true;input.disabled=password.disabled=save.disabled=!key||busy||!configured;clear.disabled=!key||busy||!draft()?.id||!configured;
  refresh.disabled=more.disabled=fresh.disabled=!key||busy||!configured;more.hidden=cursor===null;save.textContent=key&&draft().id?'선택 글 수정':'공개 의견 등록';}
 function render(){list.replaceChildren();for(const post of items){const row=make('div'),body=make('p',post.opinion),edit=make('button','수정할 글 선택');body.style.whiteSpace='pre-wrap';edit.type='button';
  edit.addEventListener('click',()=>{if(busy||!alive)return;remember();const d=draft();if(d.text&&d.text!==post.opinion){status.textContent='현재 초안이 있습니다. 초안을 비운 뒤 다른 글을 선택해 주세요.';return;}
   d.text=post.opinion;d.id=post.id;d.revision=post.revision;d.unknown=false;input.value=d.text;password.value='';controls();});row.append(body,edit);list.append(row);}controls();}
 async function load(append=false){if(!key||busy||!alive)return;const selected=readSelection();if(!selected||selected.key!==key){sync();return;}
  const token=epoch,current=key;busy=true;controls();let r;try{r=await hosted.client.list({...selected.value,limit:20,afterId:append?cursor:null});}catch{r={ok:false,code:'REQUEST_FAILED'};}
  if(!alive||token!==epoch||current!==key)return;busy=false;if(!r.ok){status.textContent=message(r.code);controls();return;}
  if(!append)items=[];const ids=new Set(items.map(x=>x.id));for(const post of r.items)if(!ids.has(post.id)){items.push(post);ids.add(post.id);}cursor=r.nextAfterId;
  const d=draft();if(d.unknown){let checked;try{checked=await hosted.client.read({...selected.value,id:d.id||d.newId});}catch{checked={ok:false};}
   if(!alive||token!==epoch||current!==key)return;const found=checked.ok?checked.post:null;
   if(found&&found.opinion===(d.pendingAction==='clear'?null:d.text)){d.id=found.id;d.revision=found.revision;d.unknown=false;if(d.pendingAction==='clear'){d.text='';input.value='';}status.textContent='저장된 내용을 확인했습니다.';}
   else if(checked.code==='NOT_FOUND'&&d.pendingAction==='create'){d.unknown=false;status.textContent='등록된 글이 없습니다. 같은 초안으로 다시 시도할 수 있습니다.';}
   else status.textContent='이전 요청 결과가 초안과 다르거나 확인되지 않았습니다. 초안은 유지했습니다.';}
  else status.textContent=items.length?'공개 의견을 읽었습니다. 수정·내용 삭제에는 해당 글의 비밀번호가 필요합니다.':'이 좌석에 공개된 의견이 없습니다.';render();}
 async function write(clearContent=false){if(!key||busy||!alive)return;const selected=readSelection();if(!selected||selected.key!==key){sync();return;}remember();const d=draft();
  if(d.unknown){status.textContent='먼저 목록을 새로 읽어 이전 저장 결과를 확인해 주세요.';return;}
  const token=epoch,current=key;let action,args;try{if(clearContent){if(!d.id)return;action='clear';args={id:d.id,expectedRevision:d.revision};}
   else if(d.id){action='update';args={id:d.id,expectedRevision:d.revision,opinion:d.text};}
   else{if(!d.newId)d.newId=hosted.client.createDraftId();action='create';args={id:d.newId,opinion:d.text};}
  }catch{status.textContent=message('INPUT_INVALID');return;}
  const pw=password.value;password.value='';busy=true;d.unknown=true;d.pendingAction=action;controls();let r;try{r=await hosted.client[action]({...selected.value,...args,password:pw});}catch{r={ok:false,code:'OUTCOME_UNKNOWN'};}
  if(!alive||token!==epoch||current!==key)return;busy=false;
  if(!r.ok){d.unknown=r.code==='OUTCOME_UNKNOWN';status.textContent=message(r.code);controls();return;}
  d.text=r.post.opinion??'';d.id=r.post.id;d.revision=r.post.revision;d.newId=null;d.unknown=false;input.value=d.text;
  status.textContent=clearContent?'글 내용만 지웠습니다. 글 식별자와 참조는 보존됩니다.':'서버에 저장했습니다.';
  items=items.filter(p=>p.id!==r.post.id);if(r.post.opinion!==null)items.push(r.post);items.sort((a,b)=>a.id.localeCompare(b.id));render();}
 function sync(){if(!alive)return;const next=readSelection();if(next?.key!==key){remember();epoch++;busy=false;key=next?.key??null;selection=next?.value??null;items=[];cursor=null;password.value='';input.value=key?draft().text:'';render();}
  let seatLabel;try{seatLabel=getContext()?.seatLabel;}catch{}label.textContent=seatLabel?`${seatLabel} · 공개 의견`:'좌석 공개 의견';controls();
  status.textContent=hosted.client?.enabled!==true?message('UNCONFIGURED'):key?'공개되는 의견입니다. 목록 새로 읽기로 저장된 글을 확인하세요.':'좌석 연결이 확정되면 서버 의견을 사용할 수 있습니다.';}
 input.addEventListener('input',remember);save.addEventListener('click',()=>write());clear.addEventListener('click',()=>write(true));refresh.addEventListener('click',()=>load());more.addEventListener('click',()=>load(true));
 fresh.addEventListener('click',()=>{if(!key||busy)return;remember();if(draft().text){status.textContent='현재 초안을 비운 뒤 새 의견을 시작해 주세요.';return;}drafts.set(key,{text:'',id:null,revision:null,newId:null,unknown:false});password.value='';controls();});
 sync();return {sync,destroy(){if(!alive)return;remember();alive=false;epoch++;password.value='';section.remove();}};
}

/** Explicit public composer. Local/account notes are never read or copied. */
export function createPublicSeatPostsV2UI({container,getContext=()=>null,idPrefix='public-post',hosted}){
 const doc=container.ownerDocument,section=doc.createElement('section');section.className='seat-notes public-seat-posts';
 function make(tag,text,action){const e=doc.createElement(tag);if(text)e.textContent=text;if(action){e.id=`${idPrefix}-${action}`;e.setAttribute('data-action',`public-post-${action}`);}return e;}
 const heading=make('h3','공개 좌석 의견'),notice=make('p','직접 등록한 내용만 공개됩니다. 등록 후 제목과 의견은 수정할 수 없습니다. 선택 사항인 삭제용 비밀번호는 글 삭제·철회에만 사용하며, 설정하지 않으면 삭제·철회·복구할 수 없습니다.'),
 title=make('input',null,'title'),opinion=make('textarea',null,'opinion'),password=make('input',null,'delete-password'),
 save=make('button','공개 의견 등록','create'),remove=make('button','선택 글 삭제','delete'),refresh=make('button','목록 조회','refresh'),fresh=make('button','새 글 작성','new'),more=make('button','더 보기','more'),
 adopt=make('button','확인한 서버 내용 채택','adopt'),retry=make('button','확인한 결과로 재시도 준비','retry'),preview=make('p'),list=make('div',null,'list'),status=make('p');
 title.type='text';title.maxLength=300;title.setAttribute('aria-label','공개 글 제목 (선택)');opinion.rows=4;opinion.maxLength=2000;opinion.setAttribute('aria-label','공개 의견');password.type='password';password.autocomplete='off';password.setAttribute('aria-label','삭제용 비밀번호 (선택)');
 for(const b of [save,remove,refresh,fresh,more,adopt,retry])b.type='button';status.setAttribute('role','status');preview.style.whiteSpace='pre-wrap';
 const listHeading=make('h4','의견 목록');list.setAttribute('aria-label','공개 의견 목록');list.setAttribute('role','list');
 section.append(heading,notice,title,opinion,password,save,remove,fresh,listHeading,refresh,list,more,preview,adopt,retry,status);container.append(section);
 let alive=true,key=null,context=null,epoch=0,syncSerial=0,busy=false,selected=null,draftId=null,cursor=null,items=[],unknown=null,checked=null,aborter=null;
 function controls(){const ready=!!key&&hosted?.client?.enabled===true&&!busy;
  title.disabled=opinion.disabled=!ready||!!selected||!!unknown;password.disabled=!ready||!!unknown||selected?.deletePasswordEnabled===false;
  save.disabled=!ready||!!unknown||!!selected;remove.disabled=!ready||!!unknown||!selected?.deletePasswordEnabled;
  refresh.disabled=!ready;fresh.disabled=!ready||!!unknown;more.disabled=!ready||cursor===null;more.hidden=cursor===null;
  adopt.hidden=!unknown||!checked;adopt.disabled=retry.disabled=!ready;
  retry.hidden=!unknown||!checked||!(unknown.action==='create'&&checked.code==='NOT_FOUND'||unknown.action==='delete'&&checked.ok&&checked.post.deletePasswordEnabled);
  password.placeholder=selected?'이 글의 삭제·철회용 비밀번호':'선택 · 비워 두면 삭제·철회 불가';}
 function render(){list.replaceChildren();for(const post of items){const row=make('article'),t=make('h4',post.title??'제목 없음'),body=make('p',post.opinion),choose=make('button',post.deletePasswordEnabled?'삭제할 글 선택':'삭제 비밀번호 없음');body.style.whiteSpace='pre-wrap';choose.type='button';choose.disabled=!post.deletePasswordEnabled||busy||!!unknown;
   choose.addEventListener('click',()=>{if(busy||unknown||!alive||!post.deletePasswordEnabled)return;if((opinion.value||title.value)&&(opinion.value!==(selected?.opinion??'')||title.value!==(selected?.title??''))){status.textContent='작성 중인 초안을 비운 뒤 글을 선택하세요.';return;}selected=post;draftId=null;title.value=post.title??'';opinion.value=post.opinion;password.value='';controls();});row.append(t,body,choose);list.append(row);}controls();}
 async function sync(){if(!alive)return false;const serial=++syncSerial;let next=null;try{const value=await hosted.getSelection();const resolved=prepareSeatPostScope(value);if(resolved.status==='resolved')next={value,key:JSON.stringify(resolved.scope)};}catch{}
  if(!alive||serial!==syncSerial)return false;if(next?.key!==key){epoch++;aborter?.abort();busy=false;key=next?.key??null;context=next?.value??null;selected=null;draftId=null;items=[];cursor=null;unknown=checked=null;title.value=opinion.value=password.value='';preview.textContent='';render();status.textContent=key?'목록 조회 또는 명시적인 공개 글 작성을 선택하세요.':'좌석 연결이 확정되지 않았습니다.';}
  if(hosted?.client?.enabled!==true)status.textContent='공개 의견 서버가 아직 연결되지 않았습니다. 연결 후 등록과 목록 조회를 사용할 수 있습니다.';
  let name;try{name=getContext()?.seatLabel;}catch{}heading.textContent=name?`${name} · 공개 좌석 의견`:'공개 좌석 의견';controls();return true;}
 async function current(){const prior=key;return await sync()&&alive&&key&&key===prior&&hosted.client?.enabled===true;}
 async function load(append=false){if(busy||!await current()||busy)return;const token=epoch;busy=true;aborter=new AbortController();if(unknown){checked=null;preview.textContent='';}controls();let r;try{r=await hosted.client.list({...context,limit:20,afterId:append?cursor:null},{signal:aborter.signal});}catch{r={ok:false,code:'REQUEST_FAILED'};}
  if(!alive||token!==epoch)return;if(r.ok){items=append?[...items,...r.items.filter(p=>!items.some(x=>x.id===p.id))]:r.items;cursor=r.nextAfterId;status.textContent=items.length?'공개 의견을 읽었습니다.':'공개 의견이 없습니다.';
   if(unknown){let read;try{read=await hosted.client.read({...context,id:unknown.id},{signal:aborter.signal});}catch{read={ok:false,code:'REQUEST_FAILED'};}if(!alive||token!==epoch)return;
    checked=read.ok?read:read.code==='NOT_FOUND'?read:null;preview.textContent=read.ok?`현재 서버 내용 · 판본 ${read.post.revision}\n${read.post.title??''}\n${read.post.opinion}`:read.code==='NOT_FOUND'?'현재 공개 목록에 해당 글이 없습니다.':'결과를 확인하지 못했습니다. 재전송하지 않았습니다.';
    status.textContent=checked?'확인한 서버 내용을 채택하세요. 재시도가 가능한 경우에는 별도로 준비한 뒤 직접 실행해야 합니다.':message('OUTCOME_UNKNOWN');}
  }else status.textContent=message(r.code);busy=false;render();}
 async function write(action){if(busy||!await current()||busy||unknown)return;if(action==='create'?!!selected:action!=='delete'||!selected?.deletePasswordEnabled)return;
  const token=epoch,pw=password.value;password.value='';let args;try{if(action==='create'){draftId??=hosted.client.createDraftId();args={id:draftId,title:title.value===''?null:title.value,opinion:opinion.value,deletePassword:pw===''?null:pw};}
   else args={id:selected.id,expectedRevision:selected.revision,deletePassword:pw};}catch{status.textContent=message('INPUT_INVALID');return;}
  // Retain only non-secret sent state for reconciliation, not the password.
  const pending=Object.freeze({action,id:args.id,title:args.title??null,opinion:args.opinion??null,expectedRevision:args.expectedRevision??null});busy=true;aborter=new AbortController();controls();let r;
  try{r=await hosted.client[action==='delete'?'remove':'create']({...context,...args},{signal:aborter.signal});}catch{r={ok:false,code:'OUTCOME_UNKNOWN'};}if(!alive||token!==epoch)return;busy=false;
  if(!r.ok){if(r.code==='OUTCOME_UNKNOWN')unknown=pending;status.textContent=message(r.code);render();return;}
  if(action==='delete'){items=items.filter(p=>p.id!==r.id);selected=null;draftId=null;title.value=opinion.value='';status.textContent='공개 목록에서 삭제했습니다. 보존 정책에 따라 식별자와 내부 기록은 남습니다.';}
  else{selected=r.post;draftId=null;title.value=r.post.title??'';opinion.value=r.post.opinion;items=items.filter(p=>p.id!==r.post.id);items.push(r.post);items.sort((a,b)=>a.id<b.id?-1:1);status.textContent=r.post.deletePasswordEnabled?'공개 글을 등록했습니다. 제목과 의견은 수정할 수 없으며, 설정한 비밀번호로 삭제·철회할 수 있습니다.':'공개 글을 등록했습니다. 제목과 의견은 수정할 수 없으며, 비밀번호가 없어 삭제·철회할 수 없습니다.';}render();}
 refresh.addEventListener('click',()=>load());more.addEventListener('click',()=>load(true));save.addEventListener('click',()=>write('create'));remove.addEventListener('click',()=>write('delete'));
 fresh.addEventListener('click',()=>{if(!alive||!key||busy||unknown)return;if((opinion.value||title.value)&&(opinion.value!==(selected?.opinion??'')||title.value!==(selected?.title??''))){status.textContent='작성 중인 초안을 비운 뒤 새 글을 시작하세요.';return;}selected=null;draftId=null;title.value=opinion.value=password.value='';controls();});
 adopt.addEventListener('click',()=>{if(!alive||busy||!unknown||!checked)return;if(checked.ok){selected=checked.post;title.value=selected.title??'';opinion.value=selected.opinion;}else{selected=null;title.value=opinion.value='';}draftId=null;unknown=checked=null;preview.textContent='';password.value='';status.textContent='조회한 서버 상태를 채택했습니다. 요청을 재전송하지 않았습니다.';render();});
 retry.addEventListener('click',()=>{if(!alive||busy||!unknown||!checked)return;const action=unknown.action;
  if(action==='delete'&&checked.ok&&checked.post.deletePasswordEnabled){selected=checked.post;draftId=null;title.value=selected.title??'';opinion.value=selected.opinion;}
  else if(action==='create'&&checked.code==='NOT_FOUND'){selected=null;draftId=unknown.id;title.value=unknown.title??'';opinion.value=unknown.opinion??'';}else return;
  unknown=checked=null;preview.textContent='';password.value='';status.textContent=action==='delete'?'확인한 판본의 삭제를 준비했습니다. 삭제용 비밀번호를 다시 입력한 뒤 직접 삭제하세요.':'같은 글 식별자로 등록을 준비했습니다. 내용과 삭제용 비밀번호 설정을 확인한 뒤 직접 등록하세요.';render();});
 controls();sync();return Object.freeze({sync,destroy(){alive=false;epoch++;syncSerial++;aborter?.abort();title.value=opinion.value=password.value='';unknown=checked=null;section.remove();}});
}
