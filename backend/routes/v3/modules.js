/**
 * API v3: Module Routes — ADR-065
 * CRUD for sidebar modules (separate from widgets)
 */

import express from 'express';
import {
  getModulesBySpace,
  getModuleById,
  createModule,
  updateModule,
  deleteModule,
  getWidgetsBySpace,
  getTablesBySpace
} from '../../services/ModuleService.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, error, badRequest, notFound, noContent } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/v3/spaces/:spaceId/widgets-available
 * Get all widgets from projects in a space (for Widget Picker)
 * Includes both registered modules and unregistered widgets
 */
router.get('/spaces/:spaceId/widgets-available', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const widgets = await getWidgetsBySpace(parseInt(spaceId));
    success(res, widgets);
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching space widgets');
    error(res, err.message);
  }
});

/**
 * GET /api/v3/spaces/:spaceId/tables-available
 * Get tables with show_in_nav=1 from all projects in a space (for Widget Picker)
 */
router.get('/spaces/:spaceId/tables-available', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const tables = await getTablesBySpace(parseInt(spaceId));
    success(res, tables);
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching space tables');
    error(res, err.message);
  }
});

/**
 * GET /api/v3/spaces/:spaceId/modules
 * Get all sidebar modules for a space
 */
router.get('/spaces/:spaceId/modules', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const modules = await getModulesBySpace(parseInt(spaceId));
    success(res, modules);
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching modules');
    error(res, err.message);
  }
});

/**
 * GET /api/v3/modules/:moduleId
 * Get module by ID
 */
router.get('/modules/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const mod = await getModuleById(parseInt(moduleId));

    if (!mod) {
      return notFound(res, 'Module');
    }

    success(res, mod);
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching module');
    error(res, err.message);
  }
});

/**
 * POST /api/v3/spaces/:spaceId/modules
 * Register a widget as a sidebar module
 */
router.post('/spaces/:spaceId/modules', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { widget_id, sidebar_order, sidebar_icon, access_level, is_pinned, is_default } = req.body;

    if (!widget_id) {
      return badRequest(res, 'widget_id is required');
    }

    const mod = await createModule({
      widget_id,
      space_id: parseInt(spaceId),
      sidebar_order,
      sidebar_icon,
      access_level,
      is_pinned,
      is_default
    });

    created(res, mod);
  } catch (err) {
    apiLogger.error({ err }, 'Error creating module');

    if (err.message.includes('required') || err.message.includes('must be') || err.message.includes('already registered')) {
      return badRequest(res, err.message);
    }
    if (err.message.includes('not found')) {
      return notFound(res, err.message.replace(' not found', ''));
    }

    error(res, err.message);
  }
});

/**
 * PATCH /api/v3/modules/:moduleId
 * Update module metadata (sidebar_order, icon, access_level, etc.)
 */
router.patch('/modules/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const updates = req.body;

    const mod = await updateModule(parseInt(moduleId), updates);
    success(res, mod);
  } catch (err) {
    apiLogger.error({ err }, 'Error updating module');

    if (err.message === 'Module not found') {
      return notFound(res, 'Module');
    }
    if (err.message.includes('must be')) {
      return badRequest(res, err.message);
    }

    error(res, err.message);
  }
});

/**
 * DELETE /api/v3/modules/:moduleId
 * Unregister widget from sidebar (widget remains, module record deleted)
 */
router.delete('/modules/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;
    await deleteModule(parseInt(moduleId));
    noContent(res);
  } catch (err) {
    apiLogger.error({ err }, 'Error deleting module');

    if (err.message === 'Module not found') {
      return notFound(res, 'Module');
    }

    error(res, err.message);
  }
});

export default router;
