import { PayIncusPublicApiClient, PayIncusPublicApiError } from '../payincus-public-api'

const client = new PayIncusPublicApiClient({
  baseUrl: process.env.PAYINCUS_BASE_URL || 'https://panel.example.com',
  token: process.env.PAYINCUS_API_TOKEN || ''
})

async function main() {
  const amount = process.env.PAYINCUS_ADJUSTMENT_AMOUNT || '10.00'
  const reason = process.env.PAYINCUS_ADJUSTMENT_REASON || 'Manual balance correction request'

  const request = await client.createBalanceAdjustmentRequest({
    amount,
    reason,
    externalReference: `example-${Date.now()}`
  })
  console.log(`created balance adjustment request ${request.data.id}`)

  const pending = await client.listBalanceAdjustmentRequests({ status: 'pending', sort: '-createdAt' })
  console.log(`current pending requests: ${pending.data.length}`)
}

main().catch(error => {
  if (error instanceof PayIncusPublicApiError) {
    console.error(`PayIncus API error ${error.status}: ${error.message}`, error.details)
    process.exit(1)
  }
  throw error
})
