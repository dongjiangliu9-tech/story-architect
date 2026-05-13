import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import { ActivationQuotaService } from '../activation/activation-quota.service';
import { CloudProjectsService } from './cloud-projects.service';

@Controller('cloud/projects')
export class CloudProjectsController {
  constructor(
    private readonly activationQuotaService: ActivationQuotaService,
    private readonly cloudProjectsService: CloudProjectsService,
  ) {}

  @Get()
  getProjects(@Headers('x-activation-code') activationCode?: string) {
    const code = this.activationQuotaService.validateForUserData(activationCode);
    return this.cloudProjectsService.loadProjects(code);
  }

  @Post('sync')
  syncProjects(
    @Body() body: { schemaVersion?: number; projects?: unknown[]; localState?: { writerStateByProjectId?: Record<string, unknown> } },
    @Headers('x-activation-code') activationCode?: string,
  ) {
    const code = this.activationQuotaService.validateForUserData(activationCode);
    return this.cloudProjectsService.saveProjects(code, body);
  }

  @Post(':id')
  saveProject(
    @Param('id') _id: string,
    @Body() body: { project?: unknown; writerState?: unknown },
    @Headers('x-activation-code') activationCode?: string,
  ) {
    const code = this.activationQuotaService.validateForUserData(activationCode);
    return this.cloudProjectsService.upsertProject(code, body.project, body.writerState);
  }

  @Post(':id/chapters')
  saveProjectChapters(
    @Param('id') id: string,
    @Body() body: { chapters?: Record<string, string>; deletedChapters?: Array<string | number>; replace?: boolean },
    @Headers('x-activation-code') activationCode?: string,
  ) {
    const code = this.activationQuotaService.validateForUserData(activationCode);
    return this.cloudProjectsService.saveProjectChapters(code, id, body);
  }

  @Delete(':id')
  deleteProject(
    @Param('id') id: string,
    @Headers('x-activation-code') activationCode?: string,
  ) {
    const code = this.activationQuotaService.validateForUserData(activationCode);
    return this.cloudProjectsService.deleteProject(code, id);
  }
}
