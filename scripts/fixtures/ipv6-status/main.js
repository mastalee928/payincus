import {createApp,reactive} from 'vue'
import {createPinia} from 'pinia'
import i18n,{setLocale} from '@/locales/index'
import IPv6 from '@/components/PublicIpv6Addresses.vue'
import '@/styles/main.css'
const state=reactive({status:'ready',addresses:['2603:c022:8018:be00::1']})
window.ipv6Fixture={state,locale:setLocale}
createApp({components:{IPv6},setup:()=>({state}),template:'<main class="p-6 max-w-4xl mx-auto"><h1 class="text-xl mb-6">JHTONE · IPv6</h1><IPv6 :addresses="state.addresses" :status="state.status" show-empty /></main>'}).use(createPinia()).use(i18n).mount('#app')
