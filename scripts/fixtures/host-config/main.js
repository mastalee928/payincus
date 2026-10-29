import { createApp, ref, onMounted, nextTick } from 'vue'
import { createPinia } from 'pinia'
import i18n, { setLocale } from '@/locales/index'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import MyHostConfigTab from '@/components/host/MyHostConfigTab.vue'
import { pending } from './api.js'
import '@/styles/main.css'
createApp({ setup() {
 const component=ref(),theme=useThemeStore(),auth=useAuthStore(),toast=useToast(),active=ref(true),mounted=ref(true),saved=ref(0)
 const host=ref({ id:11,name:'fixture-node',url:'https://node.example.test',countryCode:'us',location:'Fixture host',instanceType:'container' })
 const session=(id=1,sid='host-config-session',role='admin')=>{auth.user={id,username:'fixture-account',role,email:'fixture@example.test'};auth.token='fixture.'+btoa(JSON.stringify({sid}))+'.fixture'}
 const params=new URLSearchParams(location.search)
 if(params.has('user'))host.value={...host.value,name:'PEER1-node'}
 session(1,'host-config-session',params.has('user')?'user':'admin');setLocale('zh-CN');theme.setTheme(params.has('dark')?'dark':'light')
 window.hostConfigHarness={pending,host,theme,auth,toast,active,mounted,session,setLocale,saved,t:(...args)=>i18n.global.t(...args),view:()=>component.value?.$?.setupState}
 onMounted(async()=>{await nextTick();if(params.has('error')){void window.hostConfigHarness.view().saveConfig();pending[0]?.reject(Error('Fixture save failed'))}})
 return {component,host,active,mounted,saved}
},components:{MyHostConfigTab},template:'<main class="max-w-6xl mx-auto p-4"><header class="mb-4"><h1 class="text-xl font-semibold">PayIncus · 宿主配置</h1></header><KeepAlive v-if="mounted"><MyHostConfigTab v-if="active" :host="host" @saved="saved++" ref="component"/></KeepAlive></main>'}).use(createPinia()).use(i18n).mount('#app')
