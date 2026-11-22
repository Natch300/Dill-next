import {config} from '../config.js';
import {isLiveMode} from './runtime-mode.js';
import {emptyPlatform,platformAction,PLATFORM_KEY,SESSION_KEY,clubStorageKey} from './platform-domain.js';
export class PlatformStore extends EventTarget{
  constructor(){super();this.live=isLiveMode(new URLSearchParams(location.search));this.db=emptyPlatform();this.user=null;this.loading=false;}
  changed(){this.dispatchEvent(new Event('change'));}
  async init(){
    if(this.live){const{createClient}=await import('../vendor/supabase.js');this.client=createClient(config.supabaseUrl,config.supabaseKey);const{data:{session}}=await this.client.auth.getSession();this.user=session?.user&&!session.user.is_anonymous?{id:session.user.id,email:session.user.email}:null;if(this.user)await this.rpc('save_player_profile',{p_name:session.user.user_metadata.display_name||session.user.email.split('@')[0],p_onboarding:session.user.user_metadata.onboarding||{}});}
    else{this.user=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');if(!localStorage.getItem(PLATFORM_KEY))localStorage.setItem(PLATFORM_KEY,JSON.stringify(emptyPlatform()));window.addEventListener('storage',e=>{if(e.key===PLATFORM_KEY)this.refresh().catch(()=>{});});}
    await this.refresh();
    if(this.live)this.poll=setInterval(()=>{if(this.user&&!document.hidden)this.refresh().catch(()=>{});},12000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.refresh().catch(()=>{});});
  }
  async rpc(name,args={}){const{data,error}=await this.client.rpc(name,args);if(error)throw new Error(error.message);return data;}
  async refresh(){
    if(this.live){this.db=this.user?await this.rpc('platform_snapshot'):emptyPlatform();}
    else this.db=JSON.parse(localStorage.getItem(PLATFORM_KEY)||'null')||emptyPlatform();
    this.changed();
  }
  async signIn({email,password,name,onboarding,signup}){
    if(this.live){
      const result=signup?await this.client.auth.signUp({email,password,options:{data:{display_name:name,onboarding},emailRedirectTo:location.origin+location.pathname+'?live=1#dashboard'}}):await this.client.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
      if(!result.data.session)return{confirmation:true};this.user={id:result.data.user.id,email:result.data.user.email};
      await this.rpc('save_player_profile',{p_name:name||result.data.user.user_metadata.display_name||email.split('@')[0],p_onboarding:onboarding||{}});
    }else{
      email=String(email).trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid email address.');
      const save=()=>{this.db=JSON.parse(localStorage.getItem(PLATFORM_KEY));let u=this.db.profiles.find(u=>u.email===email);
        if(signup&&u)throw new Error('That player account already exists. Choose Sign in.');
        if(!signup&&!u)throw new Error('No player account with that email. Create a player account first.');
        if(!u){if(!String(name||'').trim())throw new Error('Enter your player name.');u={id:crypto.randomUUID(),email,display_name:name.trim().slice(0,60),onboarding,created_at:Date.now()};this.db.profiles.push(u);this.db.version++;localStorage.setItem(PLATFORM_KEY,JSON.stringify(this.db));}
        this.user={id:u.id,email};sessionStorage.setItem(SESSION_KEY,JSON.stringify(this.user));};
      if(navigator.locks)await navigator.locks.request(PLATFORM_KEY,save);else save();
    }
    await this.refresh();return{confirmation:false};
  }
  async logout(){if(this.live)await this.client.auth.signOut();else sessionStorage.removeItem(SESSION_KEY);this.user=null;await this.refresh();}
  async act(action,data={}){
    if(!this.user)throw new Error('Sign in first.');
    if(this.loading)throw new Error('Wait for the current action to finish.');this.loading=true;
    try{
      let result;
      if(this.live)result=await this.rpc('platform_action',{p_action:action,p_data:data});
      else{
        const save=()=>{const current=JSON.parse(localStorage.getItem(PLATFORM_KEY)),next=platformAction(current,this.user.id,action,data);localStorage.setItem(PLATFORM_KEY,JSON.stringify(next.db));if(next.club&&next.state)localStorage.setItem(clubStorageKey(next.club.id),JSON.stringify({version:1,state:next.state}));result=next;};
        if(navigator.locks)await navigator.locks.request(PLATFORM_KEY,save);else save();
      }
      await this.refresh();return result;
    }finally{this.loading=false;}
  }
  async previewInvite(token){
    if(this.live)return this.rpc('preview_membership_invite',{p_token:token});
    const inv=this.db.invites.find(i=>i.token===token&&i.kind==='membership'&&!i.revoked&&i.expires_at>Date.now());if(!inv)throw new Error('This membership invitation has expired or been revoked.');const c=this.db.clubs.find(c=>c.id===inv.club_id);return{id:c.id,name:c.name,tagline:c.tagline,logo:c.logo};
  }
  clubUrl(id){return`club.html?${this.live?'live=1&':'live=0&'}club=${encodeURIComponent(id)}#open/courts`;}
}
