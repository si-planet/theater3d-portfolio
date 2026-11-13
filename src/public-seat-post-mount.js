import { normalizeHostedPublicCatalogSettings } from './public-catalog-config.js';
import { POST_PROJECT, postId } from './private-seat-notes-contract.js';
import { createPublicSeatPostsV2Client, createPublicSeatPostsV2HTTPTransport } from './private-seat-notes.js';
import { createPublicSeatPostsV2UI } from './private-seat-notes-ui.js';

/** Public catalogue IDs are explicit server DTOs, not inferred source mappings.
 * Scope follows the validated catalog seat's nested position, not a legacy
 * renderer model or a fabricated root layoutVersionId. This is not a renderer binding.
 * This is only client input validation: the server must verify all relations
 * and approved publication policy again. No private notes, photos or storage.
 */
export function publicPostSelection(context) {
  try {
    if (!context || typeof context !== 'object') return null;
    const {venue,layout,seat}=context;
    const position=seat?.position;
    if (!venue || !layout || !seat || layout.venueId!==venue.id
      || seat.venueId!==venue.id || !position || position.layoutVersionId!==layout.id
      || position.seatId!==seat.id || Object.hasOwn(seat,'layoutVersionId')
      || Object.hasOwn(layout,'legacyModelId')) return null;
    for(const value of [venue.id,layout.id,seat.id])postId(value);
    return Object.freeze({canonicalScope:Object.freeze({projectRef:POST_PROJECT,
      venueId:venue.id,layoutEditionId:layout.id,seatId:seat.id})});
  } catch { return null; }
}

export function createPublicSeatPostMount(options={}) {
  const closed=()=>Object.freeze({configured:false,setContext(){},dispose(){}});
  const flag=options&&Object.getOwnPropertyDescriptor(options,'settings');
  if(!flag||!Object.hasOwn(flag,'value'))return closed();
  const settings=flag.value;
  if(!settings||typeof settings!=='object')return closed();
  const enabled=Object.getOwnPropertyDescriptor(settings,'enabled');
  if(!enabled||!Object.hasOwn(enabled,'value')||enabled.value!==true)return closed();
  if(Reflect.ownKeys(settings).length!==1)return closed();
  let ui;
  try {
    const normalized=normalizeHostedPublicCatalogSettings(options.catalogSettings);
    if(normalized.state!=='hosted-ready'||typeof options.fetchImpl!=='function'
      ||typeof options.createId!=='function'||!options.container?.ownerDocument)return closed();
    const {projectRef,supabaseUrl,publishableKey}=normalized.settings;
    const transport=createPublicSeatPostsV2HTTPTransport({enabled:true,
      config:{projectRef,supabaseUrl,publishableKey},fetchImpl:options.fetchImpl});
    const client=createPublicSeatPostsV2Client({enabled:true,transport,createId:options.createId});
    let selection=null,label='',disposed=false;
    ui=createPublicSeatPostsV2UI({container:options.container,idPrefix:'public-seat-posts',
      getContext:()=>({seatLabel:label}),hosted:{client,getSelection:()=>selection}});
    return Object.freeze({configured:true,setContext(context){
      if(disposed)return;selection=publicPostSelection(context);
      label=selection&&typeof context.seat.officialLabel==='string'?context.seat.officialLabel:'';
      ui.sync();
    },dispose(){if(disposed)return;disposed=true;selection=null;label='';ui.destroy();}});
  } catch {try{ui?.destroy();}catch{}return closed();}
}
