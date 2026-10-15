import { PayIncusPublicApiClient, PayIncusPublicApiError } from '../payincus-public-api'

const client = new PayIncusPublicApiClient({
  baseUrl: process.env.PAYINCUS_BASE_URL || 'https://panel.example.com',
  token: process.env.PAYINCUS_API_TOKEN || ''
})

async function main() {
  const serviceId = Number(process.env.PAYINCUS_SERVICE_ID || 0)
  const records = await client.listBillingRecords({
    serviceId: serviceId || undefined,
    sort: '-createdAt',
    pageSize: 10
  })
  const first = records.data[0]
  if (!first) {
    console.log('no billing records visible to this token')
    return
  }

  const record = await client.getBillingRecord(first.id)
  console.log(`billing record ${record.data.id}: ${record.data.amount} ${record.data.status}`)
}

main().catch(error => {
  if (error instanceof PayIncusPublicApiError) {
    console.error(`PayIncus API error ${error.status}: ${error.message}`, error.details)
    process.exit(1)
  }
  throw error
})
