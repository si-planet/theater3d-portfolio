/** Measured size/dimensions only. No codec, Blob reads or server proof. */
export const PHOTO_ROUTE_LIMITS=Object.freeze({
 preview:Object.freeze({maxBytes:64*1024*1024,maxDimension:8192,maxPixels:24000000}),
 local:Object.freeze({maxBytes:16*1024*1024,maxDimension:4096,maxPixels:null}),
 'browser-fhd':Object.freeze({maxBytes:64*1024*1024,maxDimension:8192,maxPixels:24000000}),
 ts:Object.freeze({maxBytes:25*1024*1024,maxDimension:4096,maxPixels:24000000}),
});
const positive=v=>Number.isSafeInteger(v)&&v>0;
function field(value,key){try{if(value===null||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return undefined;const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}catch{return undefined;}}
export function evaluatePhotoRegistrationLimits(input={}){
 const rawTarget=field(input,'target'),target=['preview','local','ts','browser-fhd'].includes(rawTarget)?rawTarget:null;
 const policy=target?PHOTO_ROUTE_LIMITS[target]:null,issues=[];
 const add=(code,role=null,actual=null,limit=null,unit=null)=>issues.push({code,role,actual:positive(actual)?actual:null,limit,unit});
 if(target!=='local'&&target!=='ts'&&target!=='browser-fhd'){add('target-unknown');return{target,state:'unknown',canSubmit:false,policy,issues};}
 const fileByteSize=field(input,'fileByteSize'),assets=field(input,'assets'),status=field(input,'processingStatus');
 let exceeded=false,unknown=false;
 const measureBytes=(size,role)=>{const maxBytes=target==='browser-fhd'&&role!=='original'?25*1024*1024:policy.maxBytes;if(!positive(size)){unknown=true;add('size-unknown',role,null,maxBytes,'bytes');}else if(size>maxBytes){exceeded=true;add('size-exceeded',role,size,maxBytes,'bytes');}};
 measureBytes(fileByteSize,'original');
 for(const role of ['original','display','thumbnail']){
  const asset=field(assets,role);
  if(!asset||typeof asset!=='object'||Array.isArray(asset)){unknown=true;add('assets-missing',role);continue;}
  const declaredRole=field(asset,'role');if(declaredRole!==undefined&&declaredRole!==role){unknown=true;add('assets-missing',role);}
  const size=field(asset,'byteSize'),width=field(asset,'pixelWidth'),height=field(asset,'pixelHeight');
  const maxDimension=target==='browser-fhd'&&role!=='original'?4096:policy.maxDimension;
  measureBytes(size,role);
  if(role==='original'&&positive(fileByteSize)&&positive(size)&&fileByteSize!==size){unknown=true;add('asset-size-mismatch',role,size,fileByteSize,'bytes');}
  if(!positive(width)||!positive(height)){unknown=true;add('dimensions-unknown',role,null,policy.maxDimension,'px');}
  for(const dimension of [width,height])if(positive(dimension)&&dimension>maxDimension){exceeded=true;add('dimension-exceeded',role,dimension,maxDimension,'px');}
  if(policy.maxPixels!==null&&positive(width)&&positive(height)){
   if(width>Math.floor(Number.MAX_SAFE_INTEGER/height)){unknown=true;add('dimensions-unknown',role,null,policy.maxPixels,'pixels');}
   else if(width*height>policy.maxPixels){exceeded=true;add('pixel-count-exceeded',role,width*height,policy.maxPixels,'pixels');}
  }
 }
 if(status!=='ready')add('processing-not-ready');
 const state=exceeded?'blocked':status!=='ready'?'not-ready':unknown?'unknown':'within-limits';
 return{target,state,canSubmit:state==='within-limits',policy,issues};
}
