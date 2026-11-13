import { POST_PROJECT,postExact,postClone,postId,postScope,postOpinion,postFail,postDeny } from './private-seat-notes-contract.js';
export const PRIVATE_NOTES_PROTOCOL='theater3d/private-seat-notes/v1';
export function validateOwnedNoteRequest(input){const r=postExact(postClone(input,16384),['protocol','projectRef','accountId','epoch','action','scope','payload']);
 if(r.protocol!==PRIVATE_NOTES_PROTOCOL||r.projectRef!==POST_PROJECT)postFail('PROJECT_MISMATCH');
 if(typeof r.accountId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.accountId)||!Number.isSafeInteger(r.epoch)||r.epoch<0)postFail();postScope(r.scope);
 const fields={'private.note.read':[],'private.note.create':['id','opinion'],'private.note.update':['id','expectedRevision','opinion'],'private.note.clear':['id','expectedRevision']};
 if(!Object.hasOwn(fields,r.action))postFail('OPERATION_NOT_SUPPORTED');const p=postExact(r.payload,fields[r.action]);
 if(r.action!=='private.note.read')postId(p.id);if(['private.note.create','private.note.update'].includes(r.action))postOpinion(p.opinion);
 if(['private.note.update','private.note.clear'].includes(r.action)&&(!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<1||p.expectedRevision>=Number.MAX_SAFE_INTEGER))postFail();return r;}
export function validateOwnedNoteResult(value,r){const v=postClone(value);if(v?.ok===false){postExact(v,['ok','code']);const safe=postDeny(v.code);if(safe.code!==v.code)postFail('INVALID_RESPONSE');return v;}
 postExact(v,r.action==='private.note.read'?['ok','note']:['ok','note','replayed','unchanged']);if(v.ok!==true)postFail('INVALID_RESPONSE');
 if(r.action==='private.note.read'&&v.note===null)return v;const p=postExact(v.note,['id','scope','revision','opinion']);postId(p.id);postScope(p.scope);postOpinion(p.opinion,true);
 if(!Number.isSafeInteger(p.revision)||p.revision<1||['venueId','layoutEditionId','seatId'].some(k=>p.scope[k]!==r.scope[k]))postFail('INVALID_RESPONSE');
 if(r.action!=='private.note.read'){if(typeof v.replayed!=='boolean'||typeof v.unchanged!=='boolean'||p.id!==r.payload.id||p.opinion!==(r.action==='private.note.clear'?null:r.payload.opinion))postFail('INVALID_RESPONSE');
  if(r.action==='private.note.create'){if(p.revision!==1||v.unchanged)postFail('INVALID_RESPONSE');}
  else if(v.replayed||p.revision!==r.payload.expectedRevision+(v.unchanged?0:1))postFail('INVALID_RESPONSE');}
 return v;}
