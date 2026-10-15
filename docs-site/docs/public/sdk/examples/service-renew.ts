import { PayIncusPublicApiClient, PayIncusPublicApiError } from '../payincus-public-api'

const client = new PayIncusPublicApiClient({
  baseUrl: process.env.PAYINCUS_BASE_URL || 'https://panel.example.com',
  token: process.env.PAYINCUS_API_TOKEN || ''
})

async function main() {
  const serviceId = Number(process.env.PAYINCUS_SERVICE_ID || 0)
  const months = Number(process.env.PAYINCUS_RENEW_MONTHS || 1)
  if (!serviceId) throw new Error('PAYINCUS_SERVICE_ID is required')
  if (!Number.isInteger(months) || months < 1) throw new Error('PAYINCUS_RENEW_MONTHS must be a positive integer')

  const result = await client.renewService(serviceId, months)
  console.log(`renewed service ${result.data.service.id} for ${months} month(s)`)
}

main().catch(error => {
  if (error instanceof PayIncusPublicApiError) {
    console.error(`PayIncus API error ${error.status}: ${error.message}`, error.details)
    process.exit(1)
  }
  throw error
})
