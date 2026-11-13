/** Shared, side-effect-free contract. Public DTOs never contain credentials. */
export const POST_PROJECT='portfolio-demo-disabled';
export const POST_PROTOCOL='theater3d/seat-posts/v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const errors=new WeakMap();
const CODES=new Set(['UNCONFIGURED','POLICY_UNCONFIGURED','INPUT_INVALID','LIMIT_EXCEEDED','UNREPRESENTABLE_TEXT',
 'PROJECT_MISMATCH','SCOPE_MISMATCH','SEAT_MAPPING_UNAVAILABLE','INVALID_RESPONSE','AUTHENTICATION_FAILED',
 'ACCESS_DENIED','RATE_LIMITED','BUSY_RETRY_LATER','REVISION_CONFLICT','DUPLICATE_CONFLICT','REFERENCE_REJECTED',
 'CONTRACT_REJECTED','CONFLICT','CONFLICT_RETRY_REQUIRED','TIMEOUT_RETRY_REQUIRED','STORAGE_REJECTED','OUTCOME_UNKNOWN',
 'ABORTED','REQUEST_FAILED','OPERATION_NOT_SUPPORTED','SESSION_CHANGED','SESSION_REQUIRED','SESSION_EXPIRED','NOT_FOUND']);
export function postFail(code='INPUT_INVALID'){const e=new Error('Seat post operation rejected');errors.set(e,code);throw e;}
export function postCode(error){if(errors.has(error))return errors.get(error);try{const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&Object.hasOwn(d,'value')&&CODES.has(d.value))return d.value;}catch{}return 'STORAGE_REJECTED';}
export const postDeny=code=>Object.freeze({ok:false,code:CODES.has(code)?code:'REQUEST_FAILED'});
export function postExact(value,names){if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Array.isArray(value))postFail();
 const keys=Reflect.ownKeys(value);if(keys.length!==names.length||keys.some(k=>!names.includes(k)))postFail();const out={};
 for(const k of names){const d=Object.getOwnPropertyDescriptor(value,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))postFail();out[k]=d.value;}return out;}
export function postClone(value,max=256*1024){let count=0;const seen=new Set();function visit(v,depth){if(++count>20000||depth>20)postFail('LIMIT_EXCEEDED');
 if(v===null||typeof v==='boolean')return v;if(typeof v==='string'){if(v.length>max||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))postFail();return v;}
 if(typeof v==='number'&&Number.isSafeInteger(v))return v;if(!v||typeof v!=='object'||seen.has(v))postFail();seen.add(v);let out;
 if(Array.isArray(v)){if(Object.getPrototypeOf(v)!==Array.prototype||Reflect.ownKeys(v).length!==v.length+1)postFail();out=Array.from({length:v.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(v,''+i);if(!d?.enumerable||!Object.hasOwn(d,'value'))postFail();return visit(d.value,depth+1);});}
 else{if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))postFail();out={};for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!d?.enumerable||!Object.hasOwn(d,'value'))postFail();out[k]=visit(d.value,depth+1);}}
 seen.delete(v);return Object.freeze(out);}const out=visit(value,0);if(new TextEncoder().encode(JSON.stringify(out)).length>max)postFail('LIMIT_EXCEEDED');return out;}
export function postId(v){if(typeof v!=='string'||!UUID.test(v))postFail();return v;}
export function postScope(value){const v=postExact(value,['venueId','layoutEditionId','seatId']);Object.values(v).forEach(postId);return Object.freeze(v);}
export function postOpinion(v,nullable=false){if(nullable&&v===null)return v;
 if(typeof v!=='string'||v.length<1||v.length>2000||!v.trim())postFail();
 // Opinion-only compatibility: preserve LF/CRLF/tab, reject all other ASCII
 // controls and bare CR. No normalization and no widening of general text.
 if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)||/\r(?!\n)/.test(v))postFail('UNREPRESENTABLE_TEXT');return v;}
export function postPassword(v){if(typeof v!=='string'||v.length<1||v.length>1024||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)||new TextEncoder().encode(v).length>1024)postFail();return v;}
export function validatePostRequest(value){const r=postExact(postClone(value,16384),['protocol','projectRef','action','scope','payload']);
 if(r.protocol!==POST_PROTOCOL||r.projectRef!==POST_PROJECT)postFail('PROJECT_MISMATCH');postScope(r.scope);
 const fields={'post.list':['limit','afterId'],'post.read':['id'],'post.create':['id','opinion','password'],'post.update':['id','expectedRevision','opinion','password'],'post.clear':['id','expectedRevision','password']};
 if(!Object.hasOwn(fields,r.action))postFail('OPERATION_NOT_SUPPORTED');const p=postExact(r.payload,fields[r.action]);
 if(r.action==='post.list'){if(!Number.isSafeInteger(p.limit)||p.limit<1||p.limit>50)postFail();if(p.afterId!==null)postId(p.afterId);}
 else if(r.action==='post.read')postId(p.id);
 else{postId(p.id);postPassword(p.password);if(r.action!=='post.clear')postOpinion(p.opinion);
  if(r.action!=='post.create'&&(!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<1||p.expectedRevision>=Number.MAX_SAFE_INTEGER))postFail();}
 return r;
}
export function validatePostResult(value,request){const result=postClone(value);if(result?.ok===false){postExact(result,['ok','code']);if(!CODES.has(result.code))postFail('INVALID_RESPONSE');return result;}
 const same=(a,b)=>['venueId','layoutEditionId','seatId'].every(k=>a[k]===b[k]);
 function dto(raw){const p=postExact(raw,['id','scope','revision','opinion']);postId(p.id);postScope(p.scope);
  if(!same(p.scope,request.scope)||!Number.isSafeInteger(p.revision)||p.revision<1)postFail('INVALID_RESPONSE');postOpinion(p.opinion,true);return p;}
 if(request.action==='post.list'){const r=postExact(result,['ok','items','nextAfterId']);if(r.ok!==true||!Array.isArray(r.items)||r.items.length>request.payload.limit)postFail('INVALID_RESPONSE');
  const ids=new Set();let last=request.payload.afterId;for(const item of r.items){const p=dto(item);if(p.opinion===null||ids.has(p.id)||last!==null&&p.id<=last)postFail('INVALID_RESPONSE');ids.add(p.id);last=p.id;}
  if(r.nextAfterId!==null&&(r.items.length!==request.payload.limit||r.nextAfterId!==last))postFail('INVALID_RESPONSE');
 }else if(request.action==='post.read'){const r=postExact(result,['ok','post']);if(r.ok!==true||dto(r.post).id!==request.payload.id)postFail('INVALID_RESPONSE');
 }else{const r=postExact(result,['ok','post','replayed','unchanged']);if(r.ok!==true||typeof r.replayed!=='boolean'||typeof r.unchanged!=='boolean')postFail('INVALID_RESPONSE');const p=dto(r.post);
  if(p.id!==request.payload.id||p.opinion!==(request.action==='post.clear'?null:request.payload.opinion))postFail('INVALID_RESPONSE');
  if(request.action==='post.create'){if(p.revision!==1||r.unchanged)postFail('INVALID_RESPONSE');}
  else if(r.replayed||p.revision!==request.payload.expectedRevision+(r.unchanged?0:1))postFail('INVALID_RESPONSE');
 }return result;
}

/** V2 is explicit public composition, never the account-private note protocol.
 * Published title/opinion cannot be edited. Optional password permits deletion only.
 * null deletion password means no deletion; no recovery/reset.
 */
export const PUBLIC_POST_PROTOCOL='theater3d/seat-posts/v2';
/** Public read metadata for an already-bound display copy. This does not prove
 * publication permission or storage completion: the server must bind the photo
 * to the post transactionally and exclude synthetic data before returning it.
 * No owner, original filename, EXIF, storage locator or signed URL is accepted.
 * Display delivery and write/attachment operations are deliberately separate.
 */
export function publicPostPhotoDisplay(value,post){
 const p=postExact(value,['postId','scope','photoId','photoRevision','assetId','assetRevision','mediaType','byteSize','pixelWidth','pixelHeight']);
 postId(p.postId);postScope(p.scope);
 const photoId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
 if(p.postId!==post.id||['venueId','layoutEditionId','seatId'].some(k=>p.scope[k]!==post.scope[k])
  ||!photoId.test(p.photoId)||!photoId.test(p.assetId)||p.photoId===p.assetId
  ||![p.photoRevision,p.assetRevision].every(n=>Number.isSafeInteger(n)&&n>0)
  ||!['image/jpeg','image/png','image/webp'].includes(p.mediaType)
  ||!Number.isSafeInteger(p.byteSize)||p.byteSize<1||p.byteSize>25*1024*1024
  ||![p.pixelWidth,p.pixelHeight].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096)
  ||p.pixelWidth*p.pixelHeight>24000000)postFail('INVALID_RESPONSE');
 return p;
}
export function publicPostTitle(v){if(v===null)return null;if(typeof v!=='string'||v.length<1||v.length>300||v!==v.trim()||!v.replace(/[\s\u0085]/gu,'')||/[\x00-\x1f\x7f]/.test(v))postFail();return v;}
export function publicPostAttachments(value){
 if(!Array.isArray(value)||value.length>8)postFail();const photos=new Set(),assets=new Set();
 for(const raw of value){const p=postExact(raw,['photoId','photoRevision','assetId','assetRevision']);postId(p.photoId);postId(p.assetId);
  if(p.photoId===p.assetId||photos.has(p.photoId)||assets.has(p.assetId)||![p.photoRevision,p.assetRevision].every(n=>Number.isSafeInteger(n)&&n>0))postFail();
  photos.add(p.photoId);assets.add(p.assetId);}
 return value;
}
export function validatePublicPostV2Request(value){const r=postExact(postClone(value,16384),['protocol','projectRef','action','scope','payload']);
 if(r.protocol!==PUBLIC_POST_PROTOCOL||r.projectRef!==POST_PROJECT)postFail('PROJECT_MISMATCH');postScope(r.scope);
 const fields={'post.list':['limit','afterId'],'post.read':['id'],'post.create':['id','title','opinion','deletePassword'],'post.delete':['id','expectedRevision','deletePassword']};
 if(!Object.hasOwn(fields,r.action))postFail('OPERATION_NOT_SUPPORTED');
 const attached=r.action==='post.create'&&Object.hasOwn(r.payload,'attachments');
 const p=postExact(r.payload,[...fields[r.action],...(attached?['attachments']:[])]);if(attached)publicPostAttachments(p.attachments);
 if(r.action==='post.list'){if(!Number.isSafeInteger(p.limit)||p.limit<1||p.limit>50)postFail();if(p.afterId!==null)postId(p.afterId);}
 else{postId(p.id);if(r.action!=='post.read'){if(r.action==='post.create'&&p.deletePassword===null){}else postPassword(p.deletePassword);
  if(r.action!=='post.delete'){publicPostTitle(p.title);postOpinion(p.opinion);}
  if(r.action!=='post.create'&&(!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<1||p.expectedRevision>=Number.MAX_SAFE_INTEGER))postFail();}}
 return r;
}
export function validatePublicPostV2Result(value,request){if(!['post.list','post.read','post.create','post.delete'].includes(request?.action))postFail('OPERATION_NOT_SUPPORTED');const result=postClone(value);if(result?.ok===false){postExact(result,['ok','code']);if(!CODES.has(result.code))postFail('INVALID_RESPONSE');return result;}
 function dto(raw){const hasPhotos=['post.list','post.read'].includes(request.action)&&Object.hasOwn(raw,'photos');
  const p=postExact(raw,['id','scope','revision','title','opinion','deletePasswordEnabled',...(hasPhotos?['photos']:[])]);postId(p.id);postScope(p.scope);
  if(['venueId','layoutEditionId','seatId'].some(k=>p.scope[k]!==request.scope[k])||!Number.isSafeInteger(p.revision)||p.revision<1||typeof p.deletePasswordEnabled!=='boolean')postFail('INVALID_RESPONSE');publicPostTitle(p.title);postOpinion(p.opinion);
  if(hasPhotos){if(!Array.isArray(p.photos))postFail('INVALID_RESPONSE');const ids=new Set();for(const photo of p.photos){const d=publicPostPhotoDisplay(photo,p);if(ids.has(d.photoId))postFail('INVALID_RESPONSE');ids.add(d.photoId);}}
  return p;}
 if(request.action==='post.list'){const r=postExact(result,['ok','items','nextAfterId']);if(r.ok!==true||!Array.isArray(r.items)||r.items.length>request.payload.limit)postFail('INVALID_RESPONSE');let last=request.payload.afterId;
  for(const raw of r.items){const p=dto(raw);if(last!==null&&p.id<=last)postFail('INVALID_RESPONSE');last=p.id;}if(r.nextAfterId!==null&&(r.items.length!==request.payload.limit||r.nextAfterId!==last))postFail('INVALID_RESPONSE');}
 else if(request.action==='post.read'){const r=postExact(result,['ok','post']);if(r.ok!==true||dto(r.post).id!==request.payload.id)postFail('INVALID_RESPONSE');}
 else if(request.action==='post.delete'){const r=postExact(result,['ok','id','revision','deleted']);if(r.ok!==true||r.id!==request.payload.id||r.revision!==request.payload.expectedRevision+1||r.deleted!==true)postFail('INVALID_RESPONSE');}
 else{const r=postExact(result,['ok','post','replayed','unchanged']),p=dto(r.post);if(r.ok!==true||typeof r.replayed!=='boolean'||typeof r.unchanged!=='boolean'||p.id!==request.payload.id||p.title!==request.payload.title||p.opinion!==request.payload.opinion)postFail('INVALID_RESPONSE');
  if(request.action==='post.create'){if(p.revision!==1||r.unchanged||p.deletePasswordEnabled!==(request.payload.deletePassword!==null))postFail('INVALID_RESPONSE');}
  else if(!p.deletePasswordEnabled||r.replayed||p.revision!==request.payload.expectedRevision+(r.unchanged?0:1))postFail('INVALID_RESPONSE');}
 return result;
}
