/** Owner-only source identity projection. No filename/label/coordinate matching. */
const TWO={information_record_id:'informationRecordId',layout_version_id:'layoutVersionId',configuration_key:'configurationKey',frame_id:'frameId',seat_id:'seatId'};
const THREE={venue_id:'venueId',model_id:'modelId',model_version:'modelVersion',seat_id:'seatId',source:'source'};
const valid=v=>typeof v==='string'&&v.length>0&&v.length<=300&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v);
function bad(){throw Object.assign(Error('Invalid source seat identity'),{code:'INVALID_RESPONSE'});}
export function copyPrivatePhotoSourceContext(value){
 if(value===null)return null;
 if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))bad();
 const two=value.kind==='source2d',required=two?['kind',...Object.values(TWO)]:Object.values(THREE),optional=two?[]:['layoutVersionId','productionRunId'];
 const keys=Reflect.ownKeys(value);if(keys.some(k=>!required.includes(k)&&!optional.includes(k))||required.some(k=>!Object.hasOwn(value,k)))bad();
 const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(value,k);if(!d||!Object.hasOwn(d,'value')||!valid(d.value))bad();out[k]=d.value;}
 if(!two&&out.source!=='user_selected')bad();return Object.freeze(out);
}
export function projectPrivatePhotoSourceContext(photo){
 // Only a direct canonical binding plus its recorded original identity qualifies.
 if(!photo?.seat_id||!photo?.venue_id||!photo.registration_context)return null;
 const source=photo.registration_context,two=source.kind==='source2d';if(!two&&source.kind!=='legacy3d')return null;
 const out=two?{kind:'source2d'}:{};
 for(const [from,to] of Object.entries(two?TWO:THREE))out[to]=source[from];
 if(!two)for(const [from,to] of [['layout_version_id','layoutVersionId'],['production_run_id','productionRunId']])if(source[from]!=null)out[to]=source[from];
 try{return copyPrivatePhotoSourceContext(out);}catch{return null;}
}
