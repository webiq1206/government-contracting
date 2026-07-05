import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AgentLog, AgentsData, CallCard, CallLogInput, ComplianceItem, Contract, GetAgentLogsParams, GetOpportunitiesParams, GetSubsParams, HealthStatus, IntegrationStatus, KpiData, LoginInput, LoginResult, OkResult, Opportunity, OpportunityActionInput, PipelineSummary, ProfileData, ProfileInput, ScoringWeight, SessionUser, SubUpdate, Subcontractor } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * @summary Health check
 */
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getLoginUrl: () => string;
/**
 * @summary Login
 */
export declare const login: (loginInput: LoginInput, options?: RequestInit) => Promise<LoginResult>;
export declare const getLoginMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginInput>;
}, TContext>;
export type LoginMutationResult = NonNullable<Awaited<ReturnType<typeof login>>>;
export type LoginMutationBody = BodyType<LoginInput>;
export type LoginMutationError = ErrorType<void>;
/**
* @summary Login
*/
export declare const useLogin: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginInput>;
}, TContext>;
export declare const getLogoutUrl: () => string;
/**
 * @summary Logout
 */
export declare const logout: (options?: RequestInit) => Promise<OkResult>;
export declare const getLogoutMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
export type LogoutMutationResult = NonNullable<Awaited<ReturnType<typeof logout>>>;
export type LogoutMutationError = ErrorType<unknown>;
/**
* @summary Logout
*/
export declare const useLogout: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
export declare const getGetMeUrl: () => string;
/**
 * @summary Get current user
 */
export declare const getMe: (options?: RequestInit) => Promise<SessionUser>;
export declare const getGetMeQueryKey: () => readonly ["/api/auth/me"];
export declare const getGetMeQueryOptions: <TData = Awaited<ReturnType<typeof getMe>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMeQueryResult = NonNullable<Awaited<ReturnType<typeof getMe>>>;
export type GetMeQueryError = ErrorType<void>;
/**
 * @summary Get current user
 */
export declare function useGetMe<TData = Awaited<ReturnType<typeof getMe>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetOpportunitiesUrl: (params?: GetOpportunitiesParams) => string;
/**
 * @summary Get pipeline opportunities
 */
export declare const getOpportunities: (params?: GetOpportunitiesParams, options?: RequestInit) => Promise<Opportunity[]>;
export declare const getGetOpportunitiesQueryKey: (params?: GetOpportunitiesParams) => readonly ["/api/opportunities", ...GetOpportunitiesParams[]];
export declare const getGetOpportunitiesQueryOptions: <TData = Awaited<ReturnType<typeof getOpportunities>>, TError = ErrorType<unknown>>(params?: GetOpportunitiesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOpportunities>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getOpportunities>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetOpportunitiesQueryResult = NonNullable<Awaited<ReturnType<typeof getOpportunities>>>;
export type GetOpportunitiesQueryError = ErrorType<unknown>;
/**
 * @summary Get pipeline opportunities
 */
export declare function useGetOpportunities<TData = Awaited<ReturnType<typeof getOpportunities>>, TError = ErrorType<unknown>>(params?: GetOpportunitiesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOpportunities>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetOpportunityUrl: (id: string) => string;
/**
 * @summary Get single opportunity
 */
export declare const getOpportunity: (id: string, options?: RequestInit) => Promise<Opportunity>;
export declare const getGetOpportunityQueryKey: (id: string) => readonly [`/api/opportunities/${string}`];
export declare const getGetOpportunityQueryOptions: <TData = Awaited<ReturnType<typeof getOpportunity>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOpportunity>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getOpportunity>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetOpportunityQueryResult = NonNullable<Awaited<ReturnType<typeof getOpportunity>>>;
export type GetOpportunityQueryError = ErrorType<void>;
/**
 * @summary Get single opportunity
 */
export declare function useGetOpportunity<TData = Awaited<ReturnType<typeof getOpportunity>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOpportunity>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getOpportunityActionUrl: (id: string) => string;
/**
 * @summary Perform action on opportunity (pursue/dismiss/advance)
 */
export declare const opportunityAction: (id: string, opportunityActionInput: OpportunityActionInput, options?: RequestInit) => Promise<OkResult>;
export declare const getOpportunityActionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof opportunityAction>>, TError, {
        id: string;
        data: BodyType<OpportunityActionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof opportunityAction>>, TError, {
    id: string;
    data: BodyType<OpportunityActionInput>;
}, TContext>;
export type OpportunityActionMutationResult = NonNullable<Awaited<ReturnType<typeof opportunityAction>>>;
export type OpportunityActionMutationBody = BodyType<OpportunityActionInput>;
export type OpportunityActionMutationError = ErrorType<unknown>;
/**
* @summary Perform action on opportunity (pursue/dismiss/advance)
*/
export declare const useOpportunityAction: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof opportunityAction>>, TError, {
        id: string;
        data: BodyType<OpportunityActionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof opportunityAction>>, TError, {
    id: string;
    data: BodyType<OpportunityActionInput>;
}, TContext>;
export declare const getGetSubsUrl: (params?: GetSubsParams) => string;
/**
 * @summary Get subcontractor database
 */
export declare const getSubs: (params?: GetSubsParams, options?: RequestInit) => Promise<Subcontractor[]>;
export declare const getGetSubsQueryKey: (params?: GetSubsParams) => readonly ["/api/subs", ...GetSubsParams[]];
export declare const getGetSubsQueryOptions: <TData = Awaited<ReturnType<typeof getSubs>>, TError = ErrorType<unknown>>(params?: GetSubsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSubs>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSubs>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSubsQueryResult = NonNullable<Awaited<ReturnType<typeof getSubs>>>;
export type GetSubsQueryError = ErrorType<unknown>;
/**
 * @summary Get subcontractor database
 */
export declare function useGetSubs<TData = Awaited<ReturnType<typeof getSubs>>, TError = ErrorType<unknown>>(params?: GetSubsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSubs>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetSubUrl: (id: string) => string;
/**
 * @summary Get single subcontractor
 */
export declare const getSub: (id: string, options?: RequestInit) => Promise<Subcontractor>;
export declare const getGetSubQueryKey: (id: string) => readonly [`/api/subs/${string}`];
export declare const getGetSubQueryOptions: <TData = Awaited<ReturnType<typeof getSub>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSub>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSub>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSubQueryResult = NonNullable<Awaited<ReturnType<typeof getSub>>>;
export type GetSubQueryError = ErrorType<void>;
/**
 * @summary Get single subcontractor
 */
export declare function useGetSub<TData = Awaited<ReturnType<typeof getSub>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSub>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateSubUrl: (id: string) => string;
/**
 * @summary Update subcontractor
 */
export declare const updateSub: (id: string, subUpdate: SubUpdate, options?: RequestInit) => Promise<OkResult>;
export declare const getUpdateSubMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateSub>>, TError, {
        id: string;
        data: BodyType<SubUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateSub>>, TError, {
    id: string;
    data: BodyType<SubUpdate>;
}, TContext>;
export type UpdateSubMutationResult = NonNullable<Awaited<ReturnType<typeof updateSub>>>;
export type UpdateSubMutationBody = BodyType<SubUpdate>;
export type UpdateSubMutationError = ErrorType<unknown>;
/**
* @summary Update subcontractor
*/
export declare const useUpdateSub: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateSub>>, TError, {
        id: string;
        data: BodyType<SubUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateSub>>, TError, {
    id: string;
    data: BodyType<SubUpdate>;
}, TContext>;
export declare const getGetKpisUrl: () => string;
/**
 * @summary Get KPI data
 */
export declare const getKpis: (options?: RequestInit) => Promise<KpiData>;
export declare const getGetKpisQueryKey: () => readonly ["/api/analytics/kpis"];
export declare const getGetKpisQueryOptions: <TData = Awaited<ReturnType<typeof getKpis>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getKpis>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getKpis>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetKpisQueryResult = NonNullable<Awaited<ReturnType<typeof getKpis>>>;
export type GetKpisQueryError = ErrorType<unknown>;
/**
 * @summary Get KPI data
 */
export declare function useGetKpis<TData = Awaited<ReturnType<typeof getKpis>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getKpis>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetPipelineSummaryUrl: () => string;
/**
 * @summary Get pipeline summary counts by stage
 */
export declare const getPipelineSummary: (options?: RequestInit) => Promise<PipelineSummary>;
export declare const getGetPipelineSummaryQueryKey: () => readonly ["/api/analytics/pipeline-summary"];
export declare const getGetPipelineSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getPipelineSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPipelineSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPipelineSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPipelineSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getPipelineSummary>>>;
export type GetPipelineSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Get pipeline summary counts by stage
 */
export declare function useGetPipelineSummary<TData = Awaited<ReturnType<typeof getPipelineSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPipelineSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetAgentsUrl: () => string;
/**
 * @summary Get agent roster and recent job runs
 */
export declare const getAgents: (options?: RequestInit) => Promise<AgentsData>;
export declare const getGetAgentsQueryKey: () => readonly ["/api/agents"];
export declare const getGetAgentsQueryOptions: <TData = Awaited<ReturnType<typeof getAgents>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAgents>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAgents>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAgentsQueryResult = NonNullable<Awaited<ReturnType<typeof getAgents>>>;
export type GetAgentsQueryError = ErrorType<unknown>;
/**
 * @summary Get agent roster and recent job runs
 */
export declare function useGetAgents<TData = Awaited<ReturnType<typeof getAgents>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAgents>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetAgentLogsUrl: (params?: GetAgentLogsParams) => string;
/**
 * @summary Get agent activity logs
 */
export declare const getAgentLogs: (params?: GetAgentLogsParams, options?: RequestInit) => Promise<AgentLog[]>;
export declare const getGetAgentLogsQueryKey: (params?: GetAgentLogsParams) => readonly ["/api/agents/logs", ...GetAgentLogsParams[]];
export declare const getGetAgentLogsQueryOptions: <TData = Awaited<ReturnType<typeof getAgentLogs>>, TError = ErrorType<unknown>>(params?: GetAgentLogsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAgentLogs>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAgentLogs>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAgentLogsQueryResult = NonNullable<Awaited<ReturnType<typeof getAgentLogs>>>;
export type GetAgentLogsQueryError = ErrorType<unknown>;
/**
 * @summary Get agent activity logs
 */
export declare function useGetAgentLogs<TData = Awaited<ReturnType<typeof getAgentLogs>>, TError = ErrorType<unknown>>(params?: GetAgentLogsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAgentLogs>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getRunAgentUrl: (name: string) => string;
/**
 * @summary Manually trigger an agent
 */
export declare const runAgent: (name: string, options?: RequestInit) => Promise<OkResult>;
export declare const getRunAgentMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runAgent>>, TError, {
        name: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof runAgent>>, TError, {
    name: string;
}, TContext>;
export type RunAgentMutationResult = NonNullable<Awaited<ReturnType<typeof runAgent>>>;
export type RunAgentMutationError = ErrorType<unknown>;
/**
* @summary Manually trigger an agent
*/
export declare const useRunAgent: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runAgent>>, TError, {
        name: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof runAgent>>, TError, {
    name: string;
}, TContext>;
export declare const getGetProfileUrl: () => string;
/**
 * @summary Get active company profile
 */
export declare const getProfile: (options?: RequestInit) => Promise<ProfileData>;
export declare const getGetProfileQueryKey: () => readonly ["/api/profile"];
export declare const getGetProfileQueryOptions: <TData = Awaited<ReturnType<typeof getProfile>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProfile>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProfile>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProfileQueryResult = NonNullable<Awaited<ReturnType<typeof getProfile>>>;
export type GetProfileQueryError = ErrorType<unknown>;
/**
 * @summary Get active company profile
 */
export declare function useGetProfile<TData = Awaited<ReturnType<typeof getProfile>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProfile>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getSaveProfileUrl: () => string;
/**
 * @summary Save company profile
 */
export declare const saveProfile: (profileInput: ProfileInput, options?: RequestInit) => Promise<OkResult>;
export declare const getSaveProfileMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveProfile>>, TError, {
        data: BodyType<ProfileInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof saveProfile>>, TError, {
    data: BodyType<ProfileInput>;
}, TContext>;
export type SaveProfileMutationResult = NonNullable<Awaited<ReturnType<typeof saveProfile>>>;
export type SaveProfileMutationBody = BodyType<ProfileInput>;
export type SaveProfileMutationError = ErrorType<unknown>;
/**
* @summary Save company profile
*/
export declare const useSaveProfile: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveProfile>>, TError, {
        data: BodyType<ProfileInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof saveProfile>>, TError, {
    data: BodyType<ProfileInput>;
}, TContext>;
export declare const getGetComplianceUrl: () => string;
/**
 * @summary Get compliance board items
 */
export declare const getCompliance: (options?: RequestInit) => Promise<ComplianceItem[]>;
export declare const getGetComplianceQueryKey: () => readonly ["/api/compliance"];
export declare const getGetComplianceQueryOptions: <TData = Awaited<ReturnType<typeof getCompliance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCompliance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCompliance>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetComplianceQueryResult = NonNullable<Awaited<ReturnType<typeof getCompliance>>>;
export type GetComplianceQueryError = ErrorType<unknown>;
/**
 * @summary Get compliance board items
 */
export declare function useGetCompliance<TData = Awaited<ReturnType<typeof getCompliance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCompliance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetContractsUrl: () => string;
/**
 * @summary Get active contracts
 */
export declare const getContracts: (options?: RequestInit) => Promise<Contract[]>;
export declare const getGetContractsQueryKey: () => readonly ["/api/contracts"];
export declare const getGetContractsQueryOptions: <TData = Awaited<ReturnType<typeof getContracts>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getContracts>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getContracts>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetContractsQueryResult = NonNullable<Awaited<ReturnType<typeof getContracts>>>;
export type GetContractsQueryError = ErrorType<unknown>;
/**
 * @summary Get active contracts
 */
export declare function useGetContracts<TData = Awaited<ReturnType<typeof getContracts>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getContracts>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetCallCardsUrl: () => string;
/**
 * @summary Get call queue cards
 */
export declare const getCallCards: (options?: RequestInit) => Promise<CallCard[]>;
export declare const getGetCallCardsQueryKey: () => readonly ["/api/call-cards"];
export declare const getGetCallCardsQueryOptions: <TData = Awaited<ReturnType<typeof getCallCards>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCallCards>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCallCards>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetCallCardsQueryResult = NonNullable<Awaited<ReturnType<typeof getCallCards>>>;
export type GetCallCardsQueryError = ErrorType<unknown>;
/**
 * @summary Get call queue cards
 */
export declare function useGetCallCards<TData = Awaited<ReturnType<typeof getCallCards>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCallCards>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getLogCallUrl: (id: string) => string;
/**
 * @summary Log call outcome
 */
export declare const logCall: (id: string, callLogInput: CallLogInput, options?: RequestInit) => Promise<OkResult>;
export declare const getLogCallMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logCall>>, TError, {
        id: string;
        data: BodyType<CallLogInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof logCall>>, TError, {
    id: string;
    data: BodyType<CallLogInput>;
}, TContext>;
export type LogCallMutationResult = NonNullable<Awaited<ReturnType<typeof logCall>>>;
export type LogCallMutationBody = BodyType<CallLogInput>;
export type LogCallMutationError = ErrorType<unknown>;
/**
* @summary Log call outcome
*/
export declare const useLogCall: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logCall>>, TError, {
        id: string;
        data: BodyType<CallLogInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof logCall>>, TError, {
    id: string;
    data: BodyType<CallLogInput>;
}, TContext>;
export declare const getGetScoringWeightsUrl: () => string;
/**
 * @summary Get proposed scoring weights pending approval
 */
export declare const getScoringWeights: (options?: RequestInit) => Promise<ScoringWeight[]>;
export declare const getGetScoringWeightsQueryKey: () => readonly ["/api/scoring-weights"];
export declare const getGetScoringWeightsQueryOptions: <TData = Awaited<ReturnType<typeof getScoringWeights>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getScoringWeights>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getScoringWeights>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetScoringWeightsQueryResult = NonNullable<Awaited<ReturnType<typeof getScoringWeights>>>;
export type GetScoringWeightsQueryError = ErrorType<unknown>;
/**
 * @summary Get proposed scoring weights pending approval
 */
export declare function useGetScoringWeights<TData = Awaited<ReturnType<typeof getScoringWeights>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getScoringWeights>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getApproveScoringWeightUrl: (id: string) => string;
/**
 * @summary Approve proposed scoring weights
 */
export declare const approveScoringWeight: (id: string, options?: RequestInit) => Promise<OkResult>;
export declare const getApproveScoringWeightMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof approveScoringWeight>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof approveScoringWeight>>, TError, {
    id: string;
}, TContext>;
export type ApproveScoringWeightMutationResult = NonNullable<Awaited<ReturnType<typeof approveScoringWeight>>>;
export type ApproveScoringWeightMutationError = ErrorType<unknown>;
/**
* @summary Approve proposed scoring weights
*/
export declare const useApproveScoringWeight: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof approveScoringWeight>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof approveScoringWeight>>, TError, {
    id: string;
}, TContext>;
export declare const getGetIntegrationStatusUrl: () => string;
/**
 * @summary Get integration connection status
 */
export declare const getIntegrationStatus: (options?: RequestInit) => Promise<IntegrationStatus>;
export declare const getGetIntegrationStatusQueryKey: () => readonly ["/api/integrations/status"];
export declare const getGetIntegrationStatusQueryOptions: <TData = Awaited<ReturnType<typeof getIntegrationStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntegrationStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getIntegrationStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetIntegrationStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getIntegrationStatus>>>;
export type GetIntegrationStatusQueryError = ErrorType<unknown>;
/**
 * @summary Get integration connection status
 */
export declare function useGetIntegrationStatus<TData = Awaited<ReturnType<typeof getIntegrationStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntegrationStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export {};
//# sourceMappingURL=api.d.ts.map