/**
 * FragmentRegistryClient - Access SOMA's Fragment Registry
 * Self-evolving domain-specific AI agents with Genesis, Mitosis, and Neuroplasticity
 */

export interface Fragment {
  id: string;
  name: string;
  domain: string;
  expertise: number; // 0-1 score
  queryCount: number;
  successRate: number;
  lastActive: number;
  specialties: string[];
  status: 'active' | 'idle' | 'evolving';
  parent?: string; // For fragments created via mitosis
  generation: number; // Genesis=0, Mitosis=1+
}

export interface FragmentQueryResult {
  fragment: string;
  response: string;
  confidence: number;
  reasoning: string;
}

export interface FragmentStats {
  totalFragments: number;
  activeFragments: number;
  genesisEvents: number;
  mitosisEvents: number;
  neuroplasticityEvents: number;
  avgExpertise: number;
  domains: string[];
}

export class FragmentRegistryClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl = '/api/fragments', timeoutMs = 20000) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  private async call<T = any>(endpoint: string, body?: any): Promise<T> {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        ...(body && { body: JSON.stringify(body) })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } finally {
      clearTimeout(id);
    }
  }

  /**
   * Get all fragments for a specific domain
   */
  async getFragmentsForDomain(domain: string): Promise<Fragment[]> {
    return this.call(`/domain/${domain}`);
  }

  /**
   * Get all active fragments across all domains
   */
  async getAllFragments(): Promise<Fragment[]> {
    return this.call('/all');
  }

  /**
   * Query a specific fragment
   */
  async queryFragment(fragmentId: string, query: string, context?: any): Promise<FragmentQueryResult> {
    return this.call(`/${fragmentId}/query`, { query, context });
  }

  /**
   * Get fragment registry statistics
   */
  async getStats(): Promise<FragmentStats> {
    return this.call('/stats');
  }

  /**
   * Manually trigger Genesis (create new fragment)
   */
  async createFragment(domain: string, specialty: string, initialPrompt: string): Promise<Fragment> {
    return this.call('/genesis', { domain, specialty, initialPrompt });
  }

  /**
   * Suggest optimal fragment for a query
   */
  async suggestFragment(query: string, domain?: string): Promise<{ fragment: Fragment; confidence: number }> {
    return this.call('/suggest', { query, domain });
  }

  /**
   * Get fragment evolution history
   */
  async getEvolutionHistory(fragmentId: string): Promise<Array<{
    event: 'genesis' | 'mitosis' | 'neuroplasticity';
    timestamp: number;
    details: any;
  }>> {
    return this.call(`/${fragmentId}/history`);
  }

  /**
   * Get fragment performance metrics
   */
  async getFragmentMetrics(fragmentId: string): Promise<{
    avgResponseTime: number;
    successRate: number;
    satisfactionScore: number;
    queryTypes: Record<string, number>;
  }> {
    return this.call(`/${fragmentId}/metrics`);
  }
}
