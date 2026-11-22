import {config} from '../config.js';
import {demoState} from './demo.js';
import {emptyState,dispatch} from './engine.js';
import {PLATFORM_KEY,SESSION_KEY,clubStorageKey,memberRole} from './platform-domain.js';
const DEMO='jn-courtyard-demo-v1',INVITES='jn-day-invites';
// Retain the storage key so existing sample games survive the brand change.
function updateSampleBrand(state){
  if(state.settings.name==='JN Courtyard')state.settings.name='Dill Next';
  if(['Courtyard club session','JN Courtyard club session'].includes(state.session.title))state.session.title='Dill Next club session';
  if(state.session.title==='Saturday at the courtyard')state.session.title='Saturday on court';
  if(state.tournament?.name==='Courtyard Weekend Cup')state.tournament.name='Dill Next Weekend Cup';
  return state;
}
export class ClubStore extends EventTarget{
  constructor(){super();const p=new URLSearchParams(location.search);this.live=p.has('live');this.token=p.get('invite');this.clubId=p.get('club')||config.clubId;this.platformClub=p.has('club');this.storageKey=this.platformClub?clubStorageKey(this.clubId):DEMO;this.role='visitor';this.state=emptyState();this.version=0;this.status='Loading';this.pending=false;this.userId=null;}
  notify(){this.dispatchEvent(new Event('change'));}
  async rpc(name,args){const{data,error}=await this.client.rpc(name,args);if(error)throw new Error(error.message);return data;}
  localAccess(){
    if(this.token){const inv=JSON.parse(localStorage.getItem(INVITES)||'[]').find(i=>i.token===this.token&&!i.revoked&&i.expires_at>Date.now());if(!inv)throw new Error('This day-play or display link has expired or been revoked.');if(inv.club_id!==this.clubId)throw new Error('This link belongs to a different club.');this.role=inv.role;const key='jn-day-user-'+this.token;this.userId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,this.userId);return;}
    if(!this.platformClub){this.role='organizer';return;}
    const db=JSON.parse(localStorage.getItem(PLATFORM_KEY)||'{}'),user=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');this.userId=user?.id;this.clubRole=db.members?memberRole(db,this.clubId,this.userId):null;this.role=['owner','vice'].includes(this.clubRole)?'organizer':this.clubRole==='member'?'member':'visitor';
  }
  async init(){
    if(!this.live){this.localAccess();if(!this.platformClub&&!localStorage.getItem(DEMO))localStorage.setItem(DEMO,JSON.stringify({state:demoState(),version:1}));await this.refresh();window.addEventListener('storage',e=>{if([this.storageKey,PLATFORM_KEY,INVITES].includes(e.key))this.refresh().catch(e=>this.offline(e));});document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.refresh().catch(e=>this.offline(e));});return;}
    const{createClient}=await import('../vendor/supabase.js');this.client=createClient(config.supabaseUrl,config.supabaseKey);
    const{data:{session}}=await this.client.auth.getSession();this.userId=session?.user.id||null;
    if(this.token){if(!session){const{data,error}=await this.client.auth.signInAnonymously();if(error)throw error;this.userId=data.user.id;}const access=await this.rpc('accept_invite',{p_token:this.token});this.role=access.role;this.clubId=access.club_id;}
    else if(session){await this.refreshRole();}
    await this.refresh();
    this.channel=this.client.channel(`club-${this.clubId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'club_revisions',filter:`club_id=eq.${this.clubId}`},()=>this.refresh().catch(e=>this.offline(e))).subscribe(status=>{if(status==='SUBSCRIBED')this.refresh().catch(e=>this.offline(e));if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){this.status='Reconnecting · changes paused';this.notify();}});
    window.addEventListener('online',()=>this.refresh().catch(e=>this.offline(e)));window.addEventListener('offline',()=>this.offline(new Error('Offline')));document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.refresh().catch(e=>this.offline(e));});this.poll=setInterval(()=>{if(!document.hidden)this.refresh().catch(e=>this.offline(e));},15000);
  }
  async refreshRole(){const{data,error}=await this.client.from('club_members').select('role').eq('club_id',this.clubId).eq('user_id',this.userId).maybeSingle();if(error)throw error;this.clubRole=data?.role;this.role=['organizer','owner','vice'].includes(this.clubRole)?'organizer':this.clubRole==='member'?'member':'visitor';}
  offline(error){this.status='Offline · changes paused';this.lastError=error.message;if(/expired|revoked|membership|access/i.test(error.message)){this.role='visitor';this.state=emptyState();}this.notify();}
  async refresh(){
    if(!this.live){this.localAccess();if(this.role==='visitor'){this.state=emptyState();this.status='Approved membership required';this.notify();return;}const saved=JSON.parse(localStorage.getItem(this.storageKey)||'null');if(!saved)throw new Error('Club not found in this browser.');this.state=this.platformClub?saved.state:updateSampleBrand(saved.state);this.version=saved.version;this.status='Saved in this browser';this.notify();return;}
    if(!this.token&&this.userId)await this.refreshRole();if(this.role==='visitor'){this.state=emptyState();this.status='Sign in with an approved club account';this.notify();return;}
    let result;if(this.role==='organizer'){const{data,error}=await this.client.from('club_state').select('payload,version').eq('club_id',this.clubId).single();if(error)throw error;result=data;}else if(this.role==='member')result=await this.rpc('read_member_board',{p_club:this.clubId});else result=await this.rpc('read_board',{p_token:this.token});
    if(result.version>=this.version){this.state=result.payload;this.version=result.version;}this.status='Live · connected';this.notify();
  }
  async localWrite(transform){const save=()=>{const saved=JSON.parse(localStorage.getItem(this.storageKey));const next=transform(saved);if(!this.platformClub)updateSampleBrand(next.state);localStorage.setItem(this.storageKey,JSON.stringify(next));this.state=next.state;this.version=next.version;};if(navigator.locks)await navigator.locks.request(this.storageKey,save);else save();this.notify();}
  async run(command,payload={}){
    if(!this.live)this.localAccess();if(this.role!=='organizer')throw new Error('Club owner or vice owner access is required.');if(this.pending)throw new Error('Wait for the previous action to save.');if(this.live&&this.status!=='Live · connected')throw new Error('Reconnect before making changes.');this.pending=true;
    try{const expected=this.version,next=dispatch(this.state,command,payload);if(this.live){const result=await this.rpc('commit_club',{p_club:this.clubId,p_expected:expected,p_payload:next,p_action:command});this.state=result.payload;this.version=result.version;this.notify();}else await this.localWrite(saved=>{if(saved.version!==expected)throw new Error('STALE');return{state:next,version:expected+1};});return this.state;
    }catch(error){if(error.message.includes('STALE')){await this.refresh();throw new Error('Another organizer changed this club. Current courts and scores are shown; review and retry.');}throw error;}finally{this.pending=false;}
  }
  async signIn(){location.href=`./${this.live?'?live=1':''}#signin`;}
  async signOut(){if(this.client)await this.client.auth.signOut();else sessionStorage.removeItem(SESSION_KEY);location.href=`./${this.live?'?live=1':''}`;}
  async guest(action,payload={}){
    if(this.live){await this.rpc(this.role==='member'?'member_play_action':'guest_action',this.role==='member'?{p_club:this.clubId,p_action:action,p_data:payload}:{p_token:this.token,p_action:action,p_data:payload});await this.refresh();return;}
    this.localAccess();if(!['guest','member'].includes(this.role))throw new Error('Player or visitor access required.');
    await this.localWrite(saved=>{let state=saved.state;const entry=state.open.find(e=>e.playerIds.includes(this.userId));
      if(action==='join'){if(entry)throw new Error('You are already checked in.');const db=JSON.parse(localStorage.getItem(PLATFORM_KEY)||'{}'),profile=db.profiles?.find(p=>p.id===this.userId);
        if(!state.players.some(p=>p.id===this.userId)){state=dispatch(state,'add-player',{id:this.userId,name:this.role==='member'?profile.display_name:payload.name,skill:payload.skill});state.players.find(p=>p.id===this.userId).source=this.role==='member'?'member':'visitor';}
        const ids=[this.userId];if(payload.partner){const id=crypto.randomUUID();state=dispatch(state,'add-player',{id,name:payload.partner,skill:payload.skill});Object.assign(state.players.find(p=>p.id===id),{source:'visitor',managedBy:this.userId});ids.push(id);}state=dispatch(state,'join',{mode:'open',playerIds:ids});
      }else if(!entry)throw new Error('No check-in found.');else if(action==='ready'){for(const id of entry.playerIds.filter(id=>id===this.userId||state.players.find(p=>p.id===id)?.managedBy===this.userId))state=dispatch(state,'ready',{id:entry.id,playerId:id});}else if(['toggle-pause','leave'].includes(action))state=dispatch(state,'queue-action',{id:entry.id,mode:'open',action:action==='leave'?'remove':entry.status==='paused'?'resume':'pause'});else throw new Error('This action is not allowed.');return{state,version:saved.version+1};});
  }
  async invite(role){if(this.role!=='organizer')throw new Error('Club management access required.');if(this.live)return this.rpc('create_invite',{p_club:this.clubId,p_role:role,p_hours:12});const inv={token:crypto.randomUUID()+crypto.randomUUID(),club_id:this.clubId,role,expires_at:Date.now()+12*3600000,revoked:false};const save=()=>{const all=JSON.parse(localStorage.getItem(INVITES)||'[]');all.push(inv);localStorage.setItem(INVITES,JSON.stringify(all));};if(navigator.locks)await navigator.locks.request(INVITES,save);else save();return{token:inv.token,expires_at:new Date(inv.expires_at).toISOString()};}
  async revokeInvites(){if(this.role!=='organizer')throw new Error('Club management access required.');if(this.live)return this.rpc('revoke_invites',{p_club:this.clubId});const save=()=>{const all=JSON.parse(localStorage.getItem(INVITES)||'[]');all.filter(i=>i.club_id===this.clubId).forEach(i=>i.revoked=true);localStorage.setItem(INVITES,JSON.stringify(all));};if(navigator.locks)await navigator.locks.request(INVITES,save);else save();}
  async resetDemo(){if(this.live||this.platformClub)throw new Error('Only the starter clubhouse can be restored.');await this.localWrite(saved=>({state:demoState(),version:saved.version+1}));}
}
