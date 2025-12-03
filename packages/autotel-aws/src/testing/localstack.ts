/**
 * LocalStack integration helpers
 *
 * LocalStack is a cloud service emulator for local AWS development and testing.
 */

/**
 * Create LocalStack helpers for testing
 */
export function createLocalStackHelpers() {
  return {
    /**
     * Get LocalStack endpoint URL
     * @param _service - Service name (currently unused, all services use same endpoint)
     */
    getEndpoint(_service: string): string {
      const host = process.env.LOCALSTACK_HOST || 'localhost';
      const port = process.env.LOCALSTACK_PORT || '4566';
      return `http://${host}:${port}`;
    },

    /**
     * Check if LocalStack is available
     */
    async isAvailable(): Promise<boolean> {
      try {
        const response = await fetch(
          `${this.getEndpoint('health')}/_localstack/health`,
          { method: 'GET' }
        );
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
