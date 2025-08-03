#!/usr/bin/env node

/**
 * Ejemplo de uso del Sistema de Programación de Trabajos
 * Este script demuestra cómo crear y gestionar trabajos programados
 */

const axios = require('axios');

const ORCHESTRATOR_URL = 'http://localhost:3001';

async function main() {
  console.log('🚀 Demo del Sistema de Programación de Trabajos\n');

  try {
    // 1. Crear un trabajo de procesamiento diario
    console.log('📅 Creando trabajo de procesamiento diario...');
    const dailyJob = await createDailyProcessingJob();
    console.log(`✅ Trabajo creado: ${dailyJob.jobId}\n`);

    // 2. Crear un trabajo de verificación de salud
    console.log('🏥 Creando trabajo de verificación de salud...');
    const healthJob = await createHealthCheckJob();
    console.log(`✅ Trabajo creado: ${healthJob.jobId}\n`);

    // 3. Obtener todos los trabajos
    console.log('📋 Obteniendo lista de trabajos...');
    const allJobs = await getAllJobs();
    console.log(`📊 Total de trabajos: ${allJobs.count}`);
    allJobs.jobs.forEach(job => {
      console.log(`  - ${job.name} (${job.enabled ? '✅' : '❌'}) - Próxima ejecución: ${job.metadata.nextExecution}`);
    });
    console.log('');

    // 4. Ejecutar un trabajo manualmente
    console.log(`🚀 Ejecutando trabajo manualmente: ${dailyJob.jobId}...`);
    const execution = await executeJobNow(dailyJob.jobId);
    console.log(`✅ Ejecución iniciada: ${execution.executionId}\n`);

    // 5. Obtener estadísticas
    console.log('📊 Obteniendo estadísticas de trabajos...');
    const stats = await getJobsStatistics();
    console.log(`📈 Estadísticas:`);
    console.log(`  - Total: ${stats.total}`);
    console.log(`  - Habilitados: ${stats.enabled}`);
    console.log(`  - Deshabilitados: ${stats.disabled}`);
    console.log(`  - Ejecuciones totales: ${stats.totalExecutions}`);
    console.log(`  - Fallos totales: ${stats.totalFailures}\n`);

    // 6. Validar expresión cron
    console.log('🔍 Validando expresión cron...');
    const validation = await validateCronExpression('0 2 * * *', 'America/New_York');
    console.log(`✅ Expresión válida: ${validation.isValid}`);
    if (validation.nextExecutions) {
      console.log('📅 Próximas 3 ejecuciones:');
      validation.nextExecutions.slice(0, 3).forEach((date, index) => {
        console.log(`  ${index + 1}. ${new Date(date).toLocaleString()}`);
      });
    }
    console.log('');

    // 7. Deshabilitar el trabajo de prueba
    console.log(`⏸️ Deshabilitando trabajo de prueba: ${healthJob.jobId}...`);
    await toggleJob(healthJob.jobId, false);
    console.log('✅ Trabajo deshabilitado\n');

    console.log('🎉 Demo completado exitosamente!');

  } catch (error) {
    console.error('❌ Error durante la demo:', error.message);
    if (error.response?.data) {
      console.error('📋 Detalles:', error.response.data);
    }
  }
}

async function createDailyProcessingJob() {
  const response = await axios.post(`${ORCHESTRATOR_URL}/jobs`, {
    name: 'Daily Data Processing Demo',
    flowId: 'daily-processing-flow',
    cronExpression: '0 2 * * *', // Todos los días a las 2:00 AM
    timezone: 'America/New_York',
    enabled: true,
    priority: 'normal',
    flowData: {
      name: 'Daily Data Processing Flow',
      version: 1,
      nodes: [
        {
          id: 'data-filter',
          type: 'data-filter',
          config: {
            filter: 'daily_batch',
            dateRange: '24h'
          }
        },
        {
          id: 'mongodb-process',
          type: 'mongodb-operations',
          config: {
            operation: 'aggregate',
            collection: 'daily_data',
            pipeline: [
              { $match: { createdAt: { $gte: '{{yesterday}}' } } },
              { $group: { _id: '$category', total: { $sum: 1 } } }
            ]
          }
        },
        {
          id: 'result-store',
          type: 'data-store',
          config: {
            destination: 'processed_data',
            format: 'json'
          }
        }
      ],
      connections: [
        {
          sourceId: 'data-filter',
          targetId: 'mongodb-process'
        },
        {
          sourceId: 'mongodb-process',
          targetId: 'result-store'
        }
      ]
    },
    inputs: {
      batchSize: 1000,
      processingDate: '{{today}}',
      notificationEmail: 'admin@company.com'
    },
    retryPolicy: {
      maxRetries: 3,
      retryDelay: 300000, // 5 minutos
      exponentialBackoff: true
    }
  });

  return response.data;
}

async function createHealthCheckJob() {
  const response = await axios.post(`${ORCHESTRATOR_URL}/jobs`, {
    name: 'System Health Check Demo',
    flowId: 'health-check-flow',
    cronExpression: '0 * * * *', // Cada hora
    timezone: 'UTC',
    enabled: true,
    priority: 'low',
    flowData: {
      name: 'System Health Check Flow',
      version: 1,
      nodes: [
        {
          id: 'database-check',
          type: 'health-monitor',
          config: {
            checkType: 'database',
            timeout: 5000
          }
        },
        {
          id: 'api-check',
          type: 'health-monitor',
          config: {
            checkType: 'api_endpoints',
            endpoints: [
              'http://localhost:3001/health',
              'http://localhost:3002/health'
            ]
          }
        },
        {
          id: 'alert-processor',
          type: 'alert-processor',
          config: {
            thresholds: {
              warning: 500,
              critical: 2000
            },
            notificationChannels: ['email', 'slack']
          }
        }
      ],
      connections: [
        {
          sourceId: 'database-check',
          targetId: 'alert-processor'
        },
        {
          sourceId: 'api-check',
          targetId: 'alert-processor'
        }
      ]
    },
    retryPolicy: {
      maxRetries: 1,
      retryDelay: 60000, // 1 minuto
      exponentialBackoff: false
    }
  });

  return response.data;
}

async function getAllJobs() {
  const response = await axios.get(`${ORCHESTRATOR_URL}/jobs`);
  return response.data;
}

async function executeJobNow(jobId) {
  const response = await axios.post(`${ORCHESTRATOR_URL}/jobs/${jobId}/execute`);
  return response.data;
}

async function getJobsStatistics() {
  const response = await axios.get(`${ORCHESTRATOR_URL}/jobs/statistics/overview`);
  return response.data;
}

async function validateCronExpression(cronExpression, timezone) {
  const response = await axios.post(`${ORCHESTRATOR_URL}/jobs/validate/cron`, {
    cronExpression,
    timezone
  });
  return response.data;
}

async function toggleJob(jobId, enabled) {
  const response = await axios.put(`${ORCHESTRATOR_URL}/jobs/${jobId}/toggle`, {
    enabled
  });
  return response.data;
}

// Ejecutar demo si se llama directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  createDailyProcessingJob,
  createHealthCheckJob,
  getAllJobs,
  executeJobNow,
  getJobsStatistics,
  validateCronExpression,
  toggleJob
};
