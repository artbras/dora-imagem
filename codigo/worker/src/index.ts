import { Queue, Worker } from 'bullmq'

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const queueName = 'dora-image-jobs'

const queue = new Queue(queueName, { connection: { url: redisUrl } })

new Worker(
  queueName,
  async (job) => {
    console.log('[worker] processing job', job.id)
    return { ok: true }
  },
  { connection: { url: redisUrl } },
)

console.log('[worker] ready', { queueName, redisUrl })

await queue.waitUntilReady()
