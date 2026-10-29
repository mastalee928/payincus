import { createApp, reactive, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import Password from '@/components/profile/PasswordSection.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const state=reactive({mounted:true,active:true}),jwt=(sid,iat=1)=>`fixture.${btoa(JSON.stringify({sid,iat}))}.fixture`
let cached
createApp({setup(){
  const component=ref(),auth=useAuthStore(),theme=useThemeStore();auth.user={id:1,username:'fixture',role:'user',email:'fixture@example.test'};auth.token=jwt('a');theme.setTheme('light');setLocale('zh-CN')
  const clearAuth=auth.clearLocalAuth;auth.clearLocalAuth=()=>{sessionStorage.setItem('fixture-password-clear-count',String(Number(sessionStorage.getItem('fixture-password-clear-count')||0)+1));clearAuth()}
  window.passwordHarness={state,pending,auth,theme,setLocale,session:(sid,iat=1)=>auth.token=sid?jwt(sid,iat):null,view(){if(component.value)cached=component.value.$.setupState;return cached},verification(){let vm=document.querySelector('.modal-overlay')?.__vueParentComponent;while(vm&&!vm.setupState?.requestCode)vm=vm.parent;return vm?.setupState}}
  return {component,state}
},components:{Password},template:'<main class="kawaii-app-shell max-w-3xl mx-auto p-4"><KeepAlive v-if="state.mounted"><Password v-if="state.active" ref="component"/></KeepAlive></main>'}).use(createPinia()).use(i18n).mount('#app')
