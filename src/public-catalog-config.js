/** Synthetic local public-read settings only. Pure: no fetch, DOM or storage. */
const NONE=Object.freeze({schemaVersion:1,mode:'none'});
const KEY='sb_publishable_theater3d_synthetic_mock_only';
const DELIVERY='/functions/v1/theater3d-catalog-delivery';
const invalid=()=>({state:'invalid',code:'INVALID_PUBLIC_CATALOG_CONFIG'});
function loopbackOrigin(value){
 if(typeof value!=='string'||!/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?\/?$/i.test(value))return null;
 const u=new URL(value);
 if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')return null;
 return u.origin;
}
export function normalizePublicCatalogSettings(input){
 if(input===undefined)return{state:'unconfigured',settings:NONE};
 try{
  if(input===null||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return invalid();
  const keys=Reflect.ownKeys(input),allowed=['schemaVersion','mode','supabaseUrl','publishableKey','deliveryEndpoint'];
  const values={};for(const key of keys){if(typeof key!=='string'||!allowed.includes(key))return invalid();const p=Object.getOwnPropertyDescriptor(input,key);if(!p||!Object.hasOwn(p,'value')||!p.enumerable)return invalid();values[key]=p.value;}
  if(values.schemaVersion!==1)return invalid();
  if(values.mode==='none')return keys.length===2?{state:'unconfigured',settings:NONE}:invalid();
  if(values.mode!=='synthetic-supabase'||values.publishableKey!==KEY)return invalid();
  const origin=loopbackOrigin(values.supabaseUrl);if(!origin)return invalid();
  if(Object.hasOwn(values,'deliveryEndpoint')){
   const endpoint=values.deliveryEndpoint;
   if(endpoint!==DELIVERY){if(typeof endpoint!=='string'||!endpoint.endsWith(DELIVERY))return invalid();const prefix=endpoint.slice(0,-DELIVERY.length);if(prefix.endsWith('/')||loopbackOrigin(prefix)!==origin)return invalid();const url=new URL(endpoint);if(url.pathname!==DELIVERY||url.search||url.hash||url.username||url.password)return invalid();}
  }
  return{state:'synthetic-ready',settings:Object.freeze({schemaVersion:1,mode:'synthetic-supabase',supabaseUrl:origin,publishableKey:KEY,deliveryEndpoint:DELIVERY})};
 }catch{return invalid();}
}

/** Separate explicit hosted configuration; legacy synthetic build parity is unchanged. */
export function normalizeHostedPublicCatalogSettings(input){
 try{
  if(input===undefined)return {state:'unconfigured'};
  if(!input||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return invalid();
  const allowed=['schemaVersion','mode','projectRef','supabaseUrl','publishableKey'];
  const keys=Reflect.ownKeys(input),values=Object.create(null);
  if(keys.some(k=>typeof k!=='string'||!allowed.includes(k)))return invalid();
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(input,key);if(typeof key!=='string'||!d?.enumerable||!Object.hasOwn(d,'value'))return invalid();values[key]=d.value;}
  if(keys.length===2&&values.schemaVersion===1&&values.mode==='none')return {state:'unconfigured'};
  if(keys.length!==allowed.length||keys.some(k=>!allowed.includes(k))||values.schemaVersion!==1||values.mode!=='hosted-public'
    ||values.projectRef!=='portfolio-demo-disabled'||values.supabaseUrl!=='https://portfolio-demo-disabled.supabase.co'
    ||typeof values.publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{1,400}$/.test(values.publishableKey)||values.publishableKey===KEY)return invalid();
  return {state:'hosted-ready',settings:Object.freeze({...values})};
 }catch{return invalid();}
}
