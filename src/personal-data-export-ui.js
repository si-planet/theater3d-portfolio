import { preparePersonalDataExport } from './personal-data-export.js';

/** Explicit, private, copy-only backup inside the existing file menu. */
export function createPersonalDataExportUI({container,storage,origin,clock,prepare=preparePersonalDataExport,download}={}) {
  const doc=container.ownerDocument;
  const root=doc.createElement('section');root.setAttribute('aria-label','전체 개인 자료 내보내기');
  const title=doc.createElement('h3');title.textContent='전체 개인 자료 내보내기';
  const notice=doc.createElement('p');notice.className='small-note';
  notice.textContent='이 주소에 저장한 모든 극장의 배치·개인 메모·렌즈 설정을 확인하고 JSON 파일로 보관합니다. 원본 저장값은 바꾸지 않으며 사진·로그인 정보는 포함하지 않습니다.';
  const inspect=doc.createElement('button');inspect.type='button';inspect.className='quiet-button';inspect.textContent='전체 개인 자료 확인';
  const save=doc.createElement('button');save.type='button';save.className='quiet-button';save.textContent='개인 자료 JSON 저장';save.disabled=true;
  const status=doc.createElement('p');status.className='small-note';status.setAttribute('role','status');status.setAttribute('data-personal-export','summary');
  status.textContent='확인을 누르면 저장된 개인 자료의 개수를 읽습니다.';
  root.append(title,notice,inspect,save,status);container.append(root);
  let disposed=false,busy=false,epoch=0,archive=null;
  function clear(){epoch++;archive=null;busy=false;inspect.disabled=false;save.disabled=true;status.textContent='확인을 누르면 저장된 개인 자료의 개수를 읽습니다.';}
  function describe(m){
    const labels={simulations:'배치',notes:'개인 메모',lenses:'렌즈 설정'};
    return Object.entries(labels).map(([key,label])=>{
      const d=m.documents[key];
      if(d.status==='held')return label+' 확인 보류';
      if(d.status==='missing')return label+' 0개 (저장값 없음)';
      return key==='lenses'?label+' '+d.count+'개 · 즐겨찾기 '+d.favoriteCount+'개':label+' '+d.count+'개';
    }).join(' / ');
  }
  function saveFile(data){
    if(download){download(data);return;}
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=doc.createElement('a');link.href=url;link.download='theater3d-personal-data.json';
    try{link.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
  }
  async function read(shouldSave=false){
    if(disposed||busy)return;
    const serial=++epoch;busy=true;archive=null;inspect.disabled=save.disabled=true;
    status.textContent='개인 자료를 읽는 중입니다.';
    try{
      // Re-read before a download so the file is a fresh coherent snapshot.
      const result=await prepare({storage,origin,clock});
      if(disposed||serial!==epoch)return;
      archive=result.ok?result.archive:null;
      status.textContent=describe(result.manifest)+(result.ok?'. 확인 완료.':'. 형식·버전 또는 저장 중 변경을 확인해야 합니다. 기존 자료는 그대로 유지됩니다.');
      if(shouldSave&&archive){saveFile(archive);status.textContent+=' JSON 파일 저장을 요청했습니다.';}
    }catch{if(!disposed&&serial===epoch)status.textContent='개인 자료를 확인하지 못했습니다. 기존 자료는 그대로 유지됩니다.';}
    finally{if(!disposed&&serial===epoch){busy=false;inspect.disabled=false;save.disabled=archive===null;}}
  }
  const onInspect=()=>{void read();},onSave=()=>{void read(true);};
  inspect.addEventListener('click',onInspect);save.addEventListener('click',onSave);
  const dialog=container.closest('dialog'),view=doc.defaultView;
  dialog?.addEventListener('close',clear);view?.addEventListener('pagehide',clear);
  return Object.freeze({clear,dispose(){if(disposed)return;clear();disposed=true;
    inspect.removeEventListener('click',onInspect);save.removeEventListener('click',onSave);
    dialog?.removeEventListener('close',clear);view?.removeEventListener('pagehide',clear);root.remove();}});
}
