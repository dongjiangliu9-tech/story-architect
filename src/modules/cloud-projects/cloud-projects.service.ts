import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface CloudProjectsBundle {
  schemaVersion: number;
  updatedAt: string;
  projects: unknown[];
  localState?: {
    writerStateByProjectId?: Record<string, unknown>;
  };
}

@Injectable()
export class CloudProjectsService {
  private readonly storeDir =
    process.env.USER_PROJECT_STORE_DIR ||
    path.join(process.cwd(), 'data', 'user-projects');

  loadProjects(activationCode: string): CloudProjectsBundle {
    return this.loadBundle(activationCode);
  }

  saveProjects(activationCode: string, bundle: Partial<CloudProjectsBundle>): CloudProjectsBundle {
    const normalized = this.normalizeBundle(bundle);
    this.saveBundle(activationCode, normalized);
    return normalized;
  }

  upsertProject(
    activationCode: string,
    project: unknown,
    writerState?: unknown,
  ): CloudProjectsBundle {
    const bundle = this.loadBundle(activationCode);
    const incomingId = this.getProjectId(project);

    if (!incomingId) {
      return bundle;
    }

    const withoutOld = bundle.projects.filter(item => this.getProjectId(item) !== incomingId);
    bundle.projects = [...withoutOld, project];
    bundle.updatedAt = new Date().toISOString();

    if (writerState !== undefined) {
      bundle.localState = bundle.localState || {};
      bundle.localState.writerStateByProjectId = {
        ...(bundle.localState.writerStateByProjectId || {}),
        [incomingId]: writerState,
      };
    }

    this.saveBundle(activationCode, bundle);
    return bundle;
  }

  deleteProject(activationCode: string, projectId: string): CloudProjectsBundle {
    const bundle = this.loadBundle(activationCode);
    bundle.projects = bundle.projects.filter(item => this.getProjectId(item) !== projectId);
    if (bundle.localState?.writerStateByProjectId) {
      delete bundle.localState.writerStateByProjectId[projectId];
    }
    bundle.updatedAt = new Date().toISOString();
    this.saveBundle(activationCode, bundle);
    return bundle;
  }

  private normalizeBundle(bundle: Partial<CloudProjectsBundle>): CloudProjectsBundle {
    const writerStateByProjectId = bundle.localState?.writerStateByProjectId;
    return {
      schemaVersion: Number(bundle.schemaVersion || 1),
      updatedAt: new Date().toISOString(),
      projects: Array.isArray(bundle.projects) ? bundle.projects : [],
      localState: {
        writerStateByProjectId: this.isObject(writerStateByProjectId)
          ? writerStateByProjectId
          : {},
      },
    };
  }

  private loadBundle(activationCode: string): CloudProjectsBundle {
    try {
      const raw = fs.readFileSync(this.getStorePath(activationCode), 'utf8');
      const parsed = JSON.parse(raw) as Partial<CloudProjectsBundle>;
      const writerStateByProjectId = parsed.localState?.writerStateByProjectId;
      return {
        schemaVersion: Number(parsed.schemaVersion || 1),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        localState: {
          writerStateByProjectId: this.isObject(writerStateByProjectId)
            ? writerStateByProjectId
            : {},
        },
      };
    } catch {
      return {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        projects: [],
        localState: {
          writerStateByProjectId: {},
        },
      };
    }
  }

  private saveBundle(activationCode: string, bundle: CloudProjectsBundle) {
    fs.mkdirSync(this.storeDir, { recursive: true });
    const storePath = this.getStorePath(activationCode);
    const tempPath = `${storePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(bundle, null, 2));
    fs.renameSync(tempPath, storePath);
  }

  private getStorePath(activationCode: string) {
    const hash = crypto
      .createHash('sha256')
      .update(activationCode)
      .digest('hex')
      .slice(0, 32);
    return path.join(this.storeDir, `${hash}.json`);
  }

  private getProjectId(project: unknown) {
    if (!this.isObject(project)) return '';
    const id = project.id;
    return id === undefined || id === null ? '' : String(id);
  }

  private isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null;
  }
}
