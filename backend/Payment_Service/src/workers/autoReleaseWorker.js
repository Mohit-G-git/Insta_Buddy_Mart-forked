// Auto-release worker
// Polls for due auto_release_jobs and processes them transactionally
// Uses node-cron for reliable scheduling

require('dotenv').config({
  path: require('path').resolve(__dirname, '../../.env')
});

const cron = require('node-cron');
const db = require('../config/db');
const escrowService = require('../services/escrowService');
const autoReleaseJobService = require('../services/autoReleaseJobService');

// Configuration
const POLL_CRON = process.env.AUTO_RELEASE_POLL_CRON || '* * * * *';  // Every minute
const BATCH_SIZE = parseInt(process.env.AUTO_RELEASE_BATCH_SIZE, 10) || 10;
const MAX_ATTEMPTS = parseInt(process.env.AUTO_RELEASE_MAX_ATTEMPTS, 10) || 5;

// Metrics counters (logged periodically)
const metrics = {
  jobs_scheduled_total: 0,
  jobs_completed_total: 0,
  jobs_cancelled_dispute_total: 0,
  jobs_failed_total: 0,
  jobs_skipped_total: 0,
};

let isShuttingDown = false;
let isProcessing = false;

/**
 * Process a single auto-release job within a transaction
 *
 * @param {object} job - The auto_release_jobs row
 * @param {object} client - DB client (inside a transaction)
 */
async function processJob(job, client) {
  const startTime = Date.now();

  try {
    // Mark job as processing
    await autoReleaseJobService.updateJobStatus(
      job.id,
      { status: 'processing' },
      client
    );

    // Lock escrow row for update
    const escrow = await escrowService.getEscrowForUpdate(job.escrow_id, client);

    if (!escrow) {
      // Escrow was deleted — skip
      await autoReleaseJobService.updateJobStatus(
        job.id,
        { status: 'skipped', cancelledReason: 'escrow_not_found' },
        client
      );
      metrics.jobs_skipped_total++;
      console.log(`[Worker] Job ${job.id}: skipped — escrow not found`);
      return;
    }

    // Check if already released (idempotent)
    if (escrow.status === 'released') {
      await autoReleaseJobService.updateJobStatus(
        job.id,
        { status: 'skipped', cancelledReason: 'already_released' },
        client
      );
      metrics.jobs_skipped_total++;
      console.log(`[Worker] Job ${job.id}: skipped — already released`);
      return;
    }

    // Check for dispute — must not release
    if (escrow.status === 'dispute_raised') {
      await autoReleaseJobService.updateJobStatus(
        job.id,
        { status: 'cancelled', cancelledReason: 'dispute_active' },
        client
      );
      metrics.jobs_cancelled_dispute_total++;
      console.log(`[Worker] Job ${job.id}: cancelled — dispute active`);
      return;
    }

    // Only release from locked state
    if (escrow.status !== 'locked') {
      await autoReleaseJobService.updateJobStatus(
        job.id,
        { status: 'skipped', cancelledReason: `state_changed:${escrow.status}` },
        client
      );
      metrics.jobs_skipped_total++;
      console.log(`[Worker] Job ${job.id}: skipped — state is ${escrow.status}, not locked`);
      return;
    }

    // Release the escrow
    const released = await escrowService.markReleasedBySystem(job.escrow_id, client);
    if (!released) {
      await autoReleaseJobService.updateJobStatus(
        job.id,
        { status: 'failed', lastError: 'Release update returned null — concurrent modification' },
        client
      );
      metrics.jobs_failed_total++;
      console.error(`[Worker] Job ${job.id}: release failed — concurrent modification`);
      return;
    }

    // Log audit transaction
    await escrowService.logTransaction({
      escrowId: job.escrow_id,
      type: 'auto_release',
      amount: parseFloat(escrow.total_authorized),
      status: 'success',
    }, client);

    // Mark job completed
    await autoReleaseJobService.updateJobStatus(
      job.id,
      { status: 'completed' },
      client
    );

    metrics.jobs_completed_total++;
    const lagSeconds = ((Date.now() - new Date(job.due_at).getTime()) / 1000).toFixed(1);
    console.log(
      `[Worker] Job ${job.id}: completed — escrow=${job.escrow_id}, ` +
      `lag=${lagSeconds}s, duration=${Date.now() - startTime}ms`
    );

  } catch (error) {
    // Transient failure — increment attempts, mark failed if threshold exceeded
    const attempts = (job.attempts || 0) + 1;
    const newStatus = attempts >= MAX_ATTEMPTS ? 'failed' : 'scheduled';

    await autoReleaseJobService.updateJobStatus(
      job.id,
      { status: newStatus, lastError: error.message },
      client
    ).catch(() => {});  // Best-effort status update on error

    if (newStatus === 'failed') {
      metrics.jobs_failed_total++;
    }

    console.error(
      `[Worker] Job ${job.id}: error (attempt ${attempts}/${MAX_ATTEMPTS}): ${error.message}`
    );
  }
}

/**
 * Main polling loop — processes all due jobs in a batch
 */
async function pollAndProcess() {
  if (isShuttingDown || isProcessing) return;
  isProcessing = true;

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Find due jobs with row locks (SKIP LOCKED for concurrent workers)
    const jobs = await autoReleaseJobService.findDueJobs(BATCH_SIZE, client);

    if (jobs.length === 0) {
      await client.query('COMMIT');
      return;
    }

    console.log(`[Worker] Found ${jobs.length} due job(s) to process`);

    // Process each job within this transaction
    for (const job of jobs) {
      await processJob(job, client);
    }

    await client.query('COMMIT');

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Worker] Polling error:', error.message);
  } finally {
    client.release();
    isProcessing = false;
  }
}

/**
 * Log metrics summary (every 5 minutes)
 */
function logMetrics() {
  console.log('[Worker] Metrics:', JSON.stringify(metrics));
}

/**
 * Start the worker
 */
async function start() {
  try {
    await db.testConnection();
    console.log('\n✓ Auto-Release Worker starting');
    console.log(`✓ Poll schedule: ${POLL_CRON}`);
    console.log(`✓ Batch size: ${BATCH_SIZE}`);
    console.log(`✓ Max attempts: ${MAX_ATTEMPTS}\n`);

    // Schedule the polling job
    cron.schedule(POLL_CRON, pollAndProcess);

    // Log metrics every 5 minutes
    cron.schedule('*/5 * * * *', logMetrics);

    console.log('[Worker] Cron jobs scheduled. Waiting for due jobs...\n');
  } catch (error) {
    console.error('[Worker] Failed to start:', error.message);
    process.exit(1);
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

function shutdown(signal) {
  console.log(`\n[Worker] ${signal} received. Shutting down gracefully...`);
  isShuttingDown = true;

  // Wait for current processing to complete (max 30s)
  const maxWait = 30000;
  const startWait = Date.now();

  const checkInterval = setInterval(() => {
    if (!isProcessing || Date.now() - startWait > maxWait) {
      clearInterval(checkInterval);
      console.log('[Worker] Shutdown complete');
      process.exit(0);
    }
  }, 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('[Worker] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Worker] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the worker
if (require.main === module) {
  start();
}

module.exports = { start, pollAndProcess, processJob };
