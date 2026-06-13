import {
  Logger,
  Controller,
  Get,
  Post,
  Req,
  Res,
  Query,
  Param,
} from '@nestjs/common';
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
  copilotRuntimeNextJSAppRouterEndpoint,
} from '@copilotkit/runtime';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { MastraAgent } from '@ag-ui/mastra';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { Request, Response } from 'express';
import { RequestContext } from '@mastra/core/di';
import OpenAI from 'openai';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

export type ChannelsContext = {
  integrations: string;
  organization: string;
  ui: string;
};

const OPENCLAW_BRIDGE_AGENTS = new Set([
  'QG_MARKETING',
  'QG_SOCIAL_MEDIA_MANAGER',
]);

const isOpenClawBridgeEnabled = (): boolean =>
  process.env.POSTIZ_OPENCLAW_BRIDGE === 'enabled';

const resolveOpenClawGatewayToken = (): string | undefined => {
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (gatewayToken) {
    return gatewayToken;
  }

  const legacyKey = process.env.OPENAI_API_KEY?.trim();
  if (legacyKey && legacyKey.startsWith('ocgw-')) {
    return legacyKey;
  }

  return undefined;
};

const resolveOpenClawAgentId = (req: Request): string => {
  const headerAgent = req.headers['x-postiz-openclaw-agent'];
  if (typeof headerAgent === 'string' && OPENCLAW_BRIDGE_AGENTS.has(headerAgent)) {
    return headerAgent;
  }

  const propertyAgent =
    req?.body?.variables?.properties?.openclawAgent ??
    req?.body?.variables?.properties?.openclaw_agent;
  if (
    typeof propertyAgent === 'string' &&
    OPENCLAW_BRIDGE_AGENTS.has(propertyAgent)
  ) {
    return propertyAgent;
  }

  const envAgent = process.env.POSTIZ_OPENCLAW_AGENT?.trim();
  if (envAgent && OPENCLAW_BRIDGE_AGENTS.has(envAgent)) {
    return envAgent;
  }

  return 'QG_MARKETING';
};

const resolveOpenClawSessionKey = (
  req: Request,
  organization: Organization,
  agentId: string
): string => {
  const explicitKey = req.headers['x-openclaw-session-key'];
  if (typeof explicitKey === 'string' && explicitKey.length > 0) {
    return explicitKey;
  }

  const threadId =
    req?.body?.threadId ??
    req?.body?.variables?.threadId ??
    req?.body?.variables?.properties?.threadId ??
    'main';

  return `agent:${agentId.toLowerCase()}:postiz-${organization.id}-${threadId}`;
};

@Controller('/copilot')
export class CopilotController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _mastraService: MastraService
  ) {}

  private buildOpenClawAdapter(req: Request, organization: Organization) {
    const gatewayToken = resolveOpenClawGatewayToken();
    if (!gatewayToken) {
      return undefined;
    }

    const gatewayUrl =
      process.env.OPENCLAW_GATEWAY_URL?.trim() ||
      'http://host.docker.internal:18789/v1';
    const agentId = resolveOpenClawAgentId(req);
    const sessionKey = resolveOpenClawSessionKey(req, organization, agentId);
    const integrations =
      req?.body?.variables?.properties?.integrations ?? [];

    const defaultHeaders: Record<string, string> = {
      'x-openclaw-session-key': sessionKey,
      'x-openclaw-message-channel': 'postiz',
    };
    if (Array.isArray(integrations) && integrations.length > 0) {
      defaultHeaders['x-postiz-integrations'] = JSON.stringify(integrations);
    }

    const openai = new OpenAI({
      apiKey: gatewayToken,
      baseURL: gatewayUrl,
      defaultHeaders,
    });

    return {
      agentId,
      adapter: new OpenAIAdapter({
        openai,
        model: `openclaw/${agentId}`,
      }),
    };
  }

  @Post('/chat')
  chatAgent(@Req() req: Request, @Res() res: Response) {
    if (isOpenClawBridgeEnabled()) {
      const gatewayToken = resolveOpenClawGatewayToken();
      if (!gatewayToken) {
        Logger.warn(
          'OpenClaw bridge enabled but OPENCLAW_GATEWAY_TOKEN is missing'
        );
        return;
      }
    } else if (
      process.env.OPENAI_API_KEY === undefined ||
      process.env.OPENAI_API_KEY === ''
    ) {
      Logger.warn('OpenAI API key not set, chat functionality will not work');
      return;
    }

    const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
      endpoint: '/copilot/chat',
      runtime: new CopilotRuntime(),
      serviceAdapter: new OpenAIAdapter({
        model: 'gpt-4.1',
      }),
    });

    return copilotRuntimeHandler(req, res);
  }

  @Post('/agent')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async agent(
    @Req() req: Request,
    @Res() res: Response,
    @GetOrgFromRequest() organization: Organization
  ) {
    if (isOpenClawBridgeEnabled()) {
      const openClaw = this.buildOpenClawAdapter(req, organization);
      if (!openClaw) {
        Logger.warn(
          'OpenClaw bridge enabled but OPENCLAW_GATEWAY_TOKEN is missing'
        );
        return;
      }

      const runtime = new CopilotRuntime();
      const copilotRuntimeHandler = copilotRuntimeNextJSAppRouterEndpoint({
        endpoint: '/copilot/agent',
        runtime,
        serviceAdapter: openClaw.adapter,
      });

      return copilotRuntimeHandler.handleRequest(req, res);
    }

    if (
      process.env.OPENAI_API_KEY === undefined ||
      process.env.OPENAI_API_KEY === ''
    ) {
      Logger.warn('OpenAI API key not set, chat functionality will not work');
      return;
    }

    const mastra = await this._mastraService.mastra();
    const requestContext = new RequestContext<ChannelsContext>();
    requestContext.set(
      'integrations',
      req?.body?.variables?.properties?.integrations || []
    );

    requestContext.set('organization', JSON.stringify(organization));
    requestContext.set('ui', 'true');

    const agents = MastraAgent.getLocalAgents({
      resourceId: organization.id,
      mastra,
      requestContext: requestContext as any,
    });

    const runtime = new CopilotRuntime({
      agents,
    });

    const copilotRuntimeHandler = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: '/copilot/agent',
      runtime,
      serviceAdapter: new OpenAIAdapter({
        model: 'gpt-4.1',
      }),
    });

    return copilotRuntimeHandler.handleRequest(req, res);
  }

  @Get('/credits')
  calculateCredits(
    @GetOrgFromRequest() organization: Organization,
    @Query('type') type: 'ai_images' | 'ai_videos'
  ) {
    return this._subscriptionService.checkCredits(
      organization,
      type || 'ai_images'
    );
  }

  @Get('/:thread/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getMessagesList(
    @GetOrgFromRequest() organization: Organization,
    @Param('thread') threadId: string
  ): Promise<any> {
    if (isOpenClawBridgeEnabled()) {
      return { messages: [] };
    }

    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postiz').getMemory();
    try {
      return await memory.recall({
        resourceId: organization.id,
        threadId,
      });
    } catch (err) {
      return { messages: [] };
    }
  }

  @Get('/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getList(@GetOrgFromRequest() organization: Organization) {
    if (isOpenClawBridgeEnabled()) {
      return { threads: [] };
    }

    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postiz').getMemory();
    const list = await memory.listThreads({
      filter: { resourceId: organization.id },
      perPage: 100000,
      page: 0,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    });

    return {
      threads: list.threads.map((p) => ({
        id: p.id,
        title: p.title,
      })),
    };
  }
}
