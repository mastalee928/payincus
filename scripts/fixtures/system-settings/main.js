import { createApp, reactive, ref, watch, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n,{setLocale} from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import Settings from '@/views/admin/SystemConfigView.vue'
import {pending,controls} from './api.js'
import '@/styles/main.css'
const state=reactive({mounted:true,active:true}),router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<div/>'}}]})
await router.push('/admin/settings/access')
let cached
createApp({setup(){const component=ref(),theme=useThemeStore(),auth=useAuthStore();theme.setTheme('light');setLocale('zh-CN');auth.user={id:1,username:'fixture',role:'admin'};auth.token='fixture-session'
  const toast=useToast(),toasts=[],seen=new Set();watch(()=>toast.toasts.value,items=>{for(const item of items)if(!seen.has(item.id)){seen.add(item.id);toasts.push(item.message)}},{flush:'sync',deep:true})
  const session=(sid,revision=1)=>{auth.token=sid?btoa('{}')+'.'+btoa(JSON.stringify({sid,revision}))+'.fixture':null}
  session('a')
  window.settingsHarness={state,pending,controls,theme,auth,toasts,router,setLocale,session,nextTick,view(){if(component.value)cached=component.value.$.setupState;return cached}}
  return{component,state}},components:{Settings},template:'<main class="kawaii-app-shell p-4"><KeepAlive v-if="state.mounted"><Settings v-if="state.active" ref="component"/></KeepAlive></main>'}).use(createPinia()).use(i18n).use(router).mount('#app')
