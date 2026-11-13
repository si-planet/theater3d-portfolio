import {createPrivatePhotoLibrary} from './private-photo-library.js';
import {privateRegisteredPhotoMatchesSelection} from './private-photo-registration-read-contract.js';
/** Owner-only metadata index. Display bytes remain lazy and are checked by the existing core. */
export function createPrivatePhotoSeatCatalog({provider,onChange=()=>{},createLibrary=createPrivatePhotoLibrary}={}) {
 let disposed=false,serial=0,status='idle',items=[],services=[],stops=[],bound=null;
 const session=()=>{try{return provider.getSession();}catch{return null;}};
 const same=s=>s&&bound&&['projectRef','accountId','epoch'].every(k=>s[k]===bound[k]);
 const notify=()=>{try{onChange();}catch{}};
 function clear(next){serial++;status=next;items=[];bound=null;const old=services;services=[];const unsub=stops;stops=[];for(const f of unsub)f();for(const s of old)s.dispose();notify();}
 const unsubscribe=provider.subscribeSession(()=>{if(!same(session()))clear('session-required');});
 async function start(){
  clear('loading');const token=serial;bound=session();if(!bound){status='session-required';notify();return;}
  const active=()=>!disposed&&token===serial&&same(session());
  try{
   const first=createLibrary({mode:'provider',provider});services.push(first);await first.start();
   if(!active())return;const initial=first.getSnapshot();if(initial.status!=='ready')throw Error('CATALOG_UNAVAILABLE');
   const staged=[];
   for(const [i,group] of initial.groups.entries()){
    const service=i===0?first:createLibrary({mode:'provider',provider});if(i){services.push(service);await service.start();}
    if(!active())return;
    stops.push(service.subscribe(s=>{if(s.status==='session-required'&&token===serial)clear('session-required');}));
    await service.selectGroup(group.groupId);let snapshot=service.getSnapshot(),pages=0;
    while(snapshot.hasMore){if(!active())return;if(++pages>2000)throw Error('PAGE_LIMIT');await service.loadMore();snapshot=service.getSnapshot();if(snapshot.status!=='ready')throw Error('CATALOG_UNAVAILABLE');}
    if(!active())return;if(snapshot.status!=='ready')throw Error('CATALOG_UNAVAILABLE');
    for(const item of snapshot.items)if(item.sourceSeatContext&&item.display&&item.uploadStatus==='uploaded')staged.push({item,service});
   }
   if(!active())return;if(new Set(staged.map(r=>r.item.photoId)).size!==staged.length)throw Error('DUPLICATE_ID');items=staged;status='ready';notify();
  }catch{if(active()){items=[];status='error';notify();}}
 }
 function list(context){if(!same(session()))return [];return items.filter(r=>privateRegisteredPhotoMatchesSelection(r.item.sourceSeatContext,context)).map(r=>r.item);}
 async function read(photoId,context,{signal}={}){
  const row=items.find(r=>r.item.photoId===photoId&&privateRegisteredPhotoMatchesSelection(r.item.sourceSeatContext,context));
  if(!row||status!=='ready'||!same(session()))throw Error('PHOTO_UNAVAILABLE');const token=serial,s={...bound};
  const display=await row.service.getDisplay(photoId,{signal});
  if(disposed||token!==serial||!same(session())||signal?.aborted)throw Error('SESSION_CHANGED');
  const d=row.item.display;
  return {source:'imported-private',photoId,photoRevision:row.item.revision,session:{projectRef:s.projectRef,accountId:s.accountId,epoch:s.epoch},originalFilename:row.item.originalFilename,metadata:{...(row.item.sourceMetadata?.metadata??{})},seatContext:structuredClone(row.item.sourceSeatContext),display:{...display,byteSize:display.bytes.byteLength,pixelWidth:d.pixelWidth,pixelHeight:d.pixelHeight}};
 }
 return Object.freeze({start,list,read,getState:()=>({status:!same(session())&&status==='ready'?'session-required':status}),dispose(){if(disposed)return;disposed=true;unsubscribe();clear('disposed');}});
}
