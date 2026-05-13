import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface CloudProjectsBundle {
  schemaVersion: number;
  updatedAt: string;
  projects: unknown[];
  savedOutlines?: unknown[];
  localState?: {
    writerStateByProjectId?: Record<string, unknown>;
    generatedChaptersByProjectId?: Record<string, Record<string, string>>;
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
    const existing = this.loadBundle(activationCode);
    const normalized = this.normalizeBundle(bundle, existing);
    this.saveBundle(activationCode, normalized);
    return normalized;
  }

  saveOutlines(activationCode: string, savedOutlines: unknown[]): CloudProjectsBundle {
    const bundle = this.loadBundle(activationCode);
    bundle.savedOutlines = Array.isArray(savedOutlines) ? savedOutlines : [];
    bundle.updatedAt = new Date().toISOString();
    this.saveBundle(activationCode, bundle);
    return bundle;
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

    const incomingChapters = this.extractGeneratedChapters(project);
    const withoutOld = bundle.projects.filter(item => this.getProjectId(item) !== incomingId);
    bundle.projects = [...withoutOld, this.stripLargeProjectFields(project)];
    bundle.updatedAt = new Date().toISOString();
    if (incomingChapters) {
      bundle.localState = bundle.localState || {};
      bundle.localState.generatedChaptersByProjectId = {
        ...(bundle.localState.generatedChaptersByProjectId || {}),
        [incomingId]: incomingChapters,
      };
    }

    if (writerState !== undefined) {
      bundle.localState = bundle.localState || {};
      bundle.localState.writerStateByProjectId = {
        ...(bundle.localState.writerStateByProjectId || {}),
        [incomingId]: this.stripLargeWriterStateFields(writerState),
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
    if (bundle.localState?.generatedChaptersByProjectId) {
      delete bundle.localState.generatedChaptersByProjectId[projectId];
    }
    bundle.updatedAt = new Date().toISOString();
    this.saveBundle(activationCode, bundle);
    return bundle;
  }

  saveProjectChapters(
    activationCode: string,
    projectId: string,
    body: {
      chapters?: Record<string, string>;
      deletedChapters?: Array<string | number>;
      replace?: boolean;
    },
  ): CloudProjectsBundle {
    const bundle = this.loadBundle(activationCode);
    bundle.localState = bundle.localState || {};
    const byProject = bundle.localState.generatedChaptersByProjectId || {};
    const current = body.replace ? {} : { ...(byProject[projectId] || {}) };

    for (const [chapter, content] of Object.entries(body.chapters || {})) {
      if (typeof content === 'string' && content.trim()) {
        current[String(chapter)] = content;
      }
    }

    for (const chapter of body.deletedChapters || []) {
      delete current[String(chapter)];
    }

    byProject[projectId] = current;
    bundle.localState.generatedChaptersByProjectId = byProject;
    bundle.updatedAt = new Date().toISOString();
    this.saveBundle(activationCode, bundle);
    return bundle;
  }

  private normalizeBundle(bundle: Partial<CloudProjectsBundle>, existing?: CloudProjectsBundle): CloudProjectsBundle {
    const writerStateByProjectId = bundle.localState?.writerStateByProjectId;
    const incomingGeneratedChaptersByProjectId = bundle.localState?.generatedChaptersByProjectId;
    const generatedChaptersByProjectId = this.isObject(incomingGeneratedChaptersByProjectId)
      ? incomingGeneratedChaptersByProjectId
      : { ...(existing?.localState?.generatedChaptersByProjectId || {}) };
    const projects = Array.isArray(bundle.projects) ? bundle.projects : [];
    const projectIds = new Set(projects.map(project => this.getProjectId(project)).filter(Boolean));

    for (const project of projects) {
      const projectId = this.getProjectId(project);
      const chapters = this.extractGeneratedChapters(project);
      if (projectId && chapters) {
        generatedChaptersByProjectId[projectId] = chapters;
      }
    }

    for (const projectId of Object.keys(generatedChaptersByProjectId)) {
      if (!projectIds.has(projectId)) {
        delete generatedChaptersByProjectId[projectId];
      }
    }

    return {
      schemaVersion: Number(bundle.schemaVersion || 1),
      updatedAt: new Date().toISOString(),
      projects: projects.map(project => this.stripLargeProjectFields(project)),
      savedOutlines: Array.isArray(bundle.savedOutlines)
        ? bundle.savedOutlines
        : Array.isArray(existing?.savedOutlines)
          ? existing.savedOutlines
          : [],
      localState: {
        writerStateByProjectId: this.isObject(writerStateByProjectId)
          ? Object.fromEntries(Object.entries(writerStateByProjectId).map(([projectId, writerState]) => [
            projectId,
            this.stripLargeWriterStateFields(writerState),
          ]))
          : {},
        generatedChaptersByProjectId,
      },
    };
  }

  private loadBundle(activationCode: string): CloudProjectsBundle {
    try {
      const raw = fs.readFileSync(this.getStorePath(activationCode), 'utf8');
      const parsed = JSON.parse(raw) as Partial<CloudProjectsBundle>;
      const writerStateByProjectId = parsed.localState?.writerStateByProjectId;
      const generatedChaptersByProjectId = this.isObject(parsed.localState?.generatedChaptersByProjectId)
        ? { ...(parsed.localState?.generatedChaptersByProjectId || {}) }
        : {};
      const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
      for (const project of projects) {
        const projectId = this.getProjectId(project);
        const chapters = this.extractGeneratedChapters(project);
        if (projectId && chapters && !generatedChaptersByProjectId[projectId]) {
          generatedChaptersByProjectId[projectId] = chapters;
        }
      }
      return {
        schemaVersion: Number(parsed.schemaVersion || 1),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        projects: projects.map(project => this.stripLargeProjectFields(project)),
        savedOutlines: Array.isArray(parsed.savedOutlines) ? parsed.savedOutlines : [],
        localState: {
          writerStateByProjectId: this.isObject(writerStateByProjectId)
            ? Object.fromEntries(Object.entries(writerStateByProjectId).map(([projectId, writerState]) => [
              projectId,
              this.stripLargeWriterStateFields(writerState),
            ]))
            : {},
          generatedChaptersByProjectId,
        },
      };
    } catch {
      return {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        projects: [],
        savedOutlines: [],
        localState: {
          writerStateByProjectId: {},
          generatedChaptersByProjectId: {},
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

  private extractGeneratedChapters(project: unknown): Record<string, string> | undefined {
    if (!this.isObject(project) || !this.isObject(project.generatedChapters)) return undefined;
    const chapters: Record<string, string> = {};
    for (const [chapter, content] of Object.entries(project.generatedChapters)) {
      if (typeof content === 'string' && content.trim()) {
        chapters[String(chapter)] = content;
      }
    }
    return Object.keys(chapters).length > 0 ? chapters : {};
  }

  private stripLargeProjectFields(project: unknown): unknown {
    if (!this.isObject(project)) return project;
    const { generatedChapters: _generatedChapters, savedVersions: _savedVersions, ...rest } = project;
    return rest;
  }

  private stripLargeWriterStateFields(writerState: unknown): unknown {
    if (!this.isObject(writerState)) return writerState;
    const { generatedChapters: _generatedChapters, ...rest } = writerState;
    return rest;
  }

  private isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null;
  }
}
