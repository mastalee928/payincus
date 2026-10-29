import { createApp, reactive, ref, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n,{setLocale} from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import Settings from '@/views/admin/SystemConfigView.vue'
import {pending} from './api.js'
import '@/styles/main.css'
const state=reactive({mounted:true}),router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<div/>'}}]})
await router.push('/admin/settings/access')
let cached
createApp({setup(){const component=ref(),theme=useThemeStore(),auth=useAuthStore();theme.setTheme('light');setLocale('zh-CN');auth.user={id:1,username:'fixture',role:'admin'};auth.token='fixture-session'
  const toast=useToast(),toasts=[],seen=new Set();watch(()=>toast.toasts.value,items=>{for(const item of items)if(!seen.has(item.id)){seen.add(item.id);toasts.push(item.message)}},{flush:'sync',deep:true})
  window.settingsHarness={state,pending,theme,auth,toasts,router,setLocale,view(){if(component.value)cached=component.value.$.setupState;return cached}}
  return{component,state}},components:{Settings},template:'<main class="kawaii-app-shell p-4"><Settings v-if="state.mounted" ref="component"/></main>'}).use(createPinia()).use(i18n).use(router).mount('#app')
