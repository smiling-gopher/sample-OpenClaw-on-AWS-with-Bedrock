#!/usr/bin/env node
/**
 * Jira Query Skill — Example Layer 2 skill with API key injection.
 *
 * Reads JIRA_API_TOKEN and JIRA_BASE_URL from environment variables
 * (injected by skill_loader.py from SSM Parameter Store).
 *
 * This is a demonstration skill. Replace the mock with real Jira API calls.
 */

const JIRA_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_URL = process.env.JIRA_BASE_URL;

if (!JIRA_TOKEN || !JIRA_URL) {
  console.error('Error: JIRA_API_TOKEN and JIRA_BASE_URL environment variables required.');
  console.error('Ask your IT admin to configure these in the Skill Platform.');
  process.exit(1);
}

async function queryIssue(issueId) {
  // In production: call Jira REST API
  // GET ${JIRA_URL}/rest/api/3/issue/${issueId}
  // Authorization: Basic base64(email:JIRA_TOKEN)
  return {
    key: issueId,
    summary: `[Mock] Issue ${issueId} summary`,
    status: 'In Progress',
    assignee: 'alice@company.com',
    priority: 'High',
    note: `Queried from ${JIRA_URL} (API key configured via SSM)`,
  };
}

async function main() {
  const issueId = process.argv[2] || 'PROJ-123';
  const result = await queryIssue(issueId);
  console.log(JSON.stringify(result, null, 2));
}

main();
