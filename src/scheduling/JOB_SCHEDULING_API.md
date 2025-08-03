# Job Scheduling API Documentation

## Descripción General

El Sistema de Programación de Trabajos permite crear, gestionar y ejecutar tareas programadas (cron jobs) que desencadenan la ejecución de flujos de trabajo en el orquestador.

## Arquitectura

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Job Scheduler  │───►│  Queue Manager   │───►│     Workers     │
│   (Orquestador) │    │   (Orquestador)  │    │   (Remotos)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
       │                        │                        │
       │ CUÁNDO ejecutar        │ QUÉ ejecutar          │ CÓMO ejecutar
       │ (Scheduling)           │ (Task Distribution)    │ (Processing)
       └────────────────────────┴────────────────────────┘
```

## Endpoints de la API

### Base URL: `/jobs`

### 1. Crear un Trabajo Programado

```http
POST /jobs
Content-Type: application/json

{
  "name": "Daily Data Processing",
  "flowId": "daily-processing-flow",
  "cronExpression": "0 2 * * *",
  "timezone": "America/New_York",
  "enabled": true,
  "priority": "normal",
  "flowData": {
    "name": "Daily Data Processing Flow",
    "version": 1,
    "nodes": [
      {
        "id": "start",
        "type": "data-filter",
        "config": { "filter": "daily_batch" }
      },
      {
        "id": "process",
        "type": "mongodb-operations",
        "config": { "operation": "aggregate" }
      }
    ],
    "connections": [
      {
        "sourceId": "start",
        "targetId": "process"
      }
    ]
  },
  "inputs": {
    "batchSize": 1000,
    "processingDate": "{{today}}"
  },
  "retryPolicy": {
    "maxRetries": 3,
    "retryDelay": 300000,
    "exponentialBackoff": true
  }
}
```

**Respuesta:**
```json
{
  "jobId": "job-1629123456789-abc123xyz",
  "message": "Job 'Daily Data Processing' created successfully"
}
```

### 2. Obtener Todos los Trabajos

```http
GET /jobs?enabled=true&priority=high
```

**Respuesta:**
```json
{
  "jobs": [
    {
      "id": "job-1629123456789-abc123xyz",
      "name": "Daily Data Processing",
      "flowId": "daily-processing-flow",
      "cronExpression": "0 2 * * *",
      "timezone": "America/New_York",
      "enabled": true,
      "priority": "normal",
      "metadata": {
        "createdBy": "orchestrator",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "lastExecution": "2024-01-02T07:00:00.000Z",
        "nextExecution": "2024-01-03T07:00:00.000Z",
        "executionCount": 5,
        "failureCount": 0
      }
    }
  ],
  "count": 1
}
```

### 3. Obtener un Trabajo Específico

```http
GET /jobs/{jobId}
```

### 4. Actualizar un Trabajo

```http
PUT /jobs/{jobId}
Content-Type: application/json

{
  "cronExpression": "0 3 * * *",
  "enabled": false
}
```

### 5. Eliminar un Trabajo

```http
DELETE /jobs/{jobId}
```

### 6. Habilitar/Deshabilitar un Trabajo

```http
PUT /jobs/{jobId}/toggle
Content-Type: application/json

{
  "enabled": false
}
```

### 7. Ejecutar un Trabajo Inmediatamente

```http
POST /jobs/{jobId}/execute
```

**Respuesta:**
```json
{
  "executionId": "exec-1629123456789-xyz789abc",
  "message": "Job 'job-1629123456789-abc123xyz' executed successfully"
}
```

### 8. Obtener Historial de Ejecuciones

```http
GET /jobs/{jobId}/executions?limit=10
```

**Respuesta:**
```json
{
  "executions": [
    {
      "jobId": "job-1629123456789-abc123xyz",
      "executionId": "exec-1629123456789-xyz789abc",
      "status": "success",
      "startTime": "2024-01-02T07:00:00.000Z",
      "endTime": "2024-01-02T07:05:23.000Z",
      "taskId": "task-456789"
    }
  ],
  "count": 1
}
```

### 9. Obtener Estadísticas de Trabajos

```http
GET /jobs/statistics/overview
```

**Respuesta:**
```json
{
  "total": 10,
  "enabled": 8,
  "disabled": 2,
  "byPriority": {
    "high": 2,
    "normal": 6,
    "low": 2
  },
  "totalExecutions": 150,
  "totalFailures": 5,
  "upcomingJobs": [
    {
      "id": "job-1629123456789-abc123xyz",
      "name": "Daily Data Processing",
      "metadata": {
        "nextExecution": "2024-01-03T07:00:00.000Z"
      }
    }
  ],
  "timestamp": "2024-01-02T12:00:00.000Z"
}
```

### 10. Validar Expresión Cron

```http
POST /jobs/validate/cron
Content-Type: application/json

{
  "cronExpression": "0 2 * * *",
  "timezone": "America/New_York"
}
```

**Respuesta:**
```json
{
  "isValid": true,
  "nextExecutions": [
    "2024-01-03T07:00:00.000Z",
    "2024-01-04T07:00:00.000Z",
    "2024-01-05T07:00:00.000Z",
    "2024-01-06T07:00:00.000Z",
    "2024-01-07T07:00:00.000Z"
  ]
}
```

## Expresiones Cron Soportadas

| Expresión | Descripción | Ejemplo |
|-----------|-------------|---------|
| `* * * * *` | Cada minuto | `*/5 * * * *` (cada 5 minutos) |
| `0 * * * *` | Cada hora | `0 2 * * *` (a las 2:00 AM) |
| `0 0 * * *` | Cada día | `0 0 * * 1` (cada lunes) |
| `0 0 1 * *` | Cada mes | `0 0 1 1 *` (1 de enero) |

## Zonas Horarias Soportadas

- `UTC` - Tiempo Universal Coordinado
- `America/New_York` - Hora del Este de EE.UU.
- `Europe/London` - Hora del Reino Unido
- `Asia/Tokyo` - Hora de Japón
- Y todas las zonas horarias IANA estándar

## Prioridades de Trabajos

1. **high**: Trabajos críticos del sistema
2. **normal**: Trabajos regulares de procesamiento
3. **low**: Trabajos de mantenimiento y limpieza

## Políticas de Reintentos

```json
{
  "retryPolicy": {
    "maxRetries": 3,           // Máximo número de reintentos
    "retryDelay": 300000,      // Retraso entre reintentos (ms)
    "exponentialBackoff": true // Usar backoff exponencial
  }
}
```

### Backoff Exponencial
- Reintento 1: 5 minutos (300,000 ms)
- Reintento 2: 10 minutos (600,000 ms)
- Reintento 3: 20 minutos (1,200,000 ms)

## Ejemplos de Trabajos Comunes

### 1. Procesamiento Diario de Datos
```json
{
  "name": "Daily Data Processing",
  "cronExpression": "0 2 * * *",
  "timezone": "America/New_York",
  "priority": "normal"
}
```

### 2. Verificación de Salud del Sistema
```json
{
  "name": "System Health Check",
  "cronExpression": "0 * * * *",
  "timezone": "UTC",
  "priority": "low"
}
```

### 3. Respaldo Semanal
```json
{
  "name": "Weekly Backup",
  "cronExpression": "0 0 * * 0",
  "timezone": "UTC",
  "priority": "high"
}
```

### 4. Limpieza de Logs
```json
{
  "name": "Log Cleanup",
  "cronExpression": "0 0 1 * *",
  "timezone": "UTC",
  "priority": "low"
}
```

## Estados de Ejecución

- **success**: Ejecución completada exitosamente
- **failed**: Ejecución falló con error
- **timeout**: Ejecución excedió tiempo límite

## Integración con Workers

Los trabajos programados se integran seamlessly con el sistema de workers:

1. **Scheduler** crea el trabajo programado
2. **Queue Manager** distribuye la tarea a workers disponibles
3. **Workers** procesan la tarea usando los nodos del flujo
4. **Resultados** se reportan de vuelta al orquestador

## Monitoreo y Logs

El sistema proporciona logs detallados para:
- Creación/actualización de trabajos
- Ejecuciones programadas
- Fallos y reintentos
- Estadísticas de rendimiento
