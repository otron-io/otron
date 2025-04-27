# Linear Issue Analysis Workflow

This document outlines the process for analyzing Linear issues, investigating the codebase, and providing technical assessments.

## Workflow Steps

1. **Read the Linear Issue**
   - Use the WebFetchTool to read the issue details if a URL is provided
   - Note the problem description, steps to reproduce, expected behavior, etc.

2. **Analyze the Codebase**
   - Use the dispatch_agent tool to search the codebase for relevant files and code
   - Search for models, controllers, and components related to the issue
   - Focus on understanding the data flow and potential problem areas

3. **Create Technical Analysis**
   - Identify potential root causes
   - Document the problematic code patterns
   - Outline how the code should work vs. how it's currently working
   - Suggest specific fixes with code examples when possible

4. **Update the Linear Issue**
   - Add a comment with the technical analysis using `mcp__linear__linear_add_comment`
   - Use the following structure for the comment:
     ```
     ## Summary

      [Non technical very short summary grounded in the code]

     ## Technical Root Cause Analysis

     ### Core Issues Identified
     1. [Issue 1]
     2. [Issue 2]
     
     ### Problematic Code Pattern
     ```code snippet```
     
     ### Recommended Fixes
     1. [Fix 1]
     2. [Fix 2]
     ```
   - Add labels if needed using `mcp__linear__linear_update_issue`
   - Update status if needed (be aware of exact status name in the workflow)

5. **Provide Project Cost Estimates** (when applicable)
   - Categorize the project size based on scope and complexity
   - Calculate resource requirements and timeline
   - Include SQE testing overhead

## Common Tags/Labels
- bug
- enhancement
- documentation
- question

## Tips
- Be specific about which files contain the issues
- Include line numbers when possible
- Reference related PRs or issues if they exist
- Use code blocks for clarity
- Make recommendations that a developer would understand and be able to implement

## Available Tools
- WebFetchTool - for reading issue details from Linear
- dispatch_agent - for code searching
- mcp__linear__linear_add_comment - for adding comments
- mcp__linear__linear_update_issue - for updating issues
- mcp__linear__linear_search_issues - for searching issues
- mcp__linear__linear_create_issue - for creating new issues

## Project Cost Estimation Guidelines

When estimating project costs, use these guidelines for a single team in AMS:

### General Team Assumption
- Team Size: Up to 10 engineers
- Hourly Rate: $58/hour

### Project Categories

1. **Small Project**
   - Duration: Less than 2 sprints (less than 4 weeks)
   - Resource Allocation: 2-4 engineers
   - Cost Range: $18,560 - $37,120
   - Calculation: $58/hour * 40 hours/week * (2-4 engineers) * 4 weeks

2. **Medium Project**
   - Duration: Less than one cycle (less than 8 weeks)
   - Resource Allocation: 4-6 engineers
   - Cost Range: $74,240 - $111,360
   - Calculation: $58/hour * 40 hours/week * (4-6 engineers) * 8 weeks

3. **Large Project**
   - Duration: 8-16 weeks (1-2 cycles)
   - Resource Allocation: 6-10 engineers
   - Cost Range: $222,720 - $371,200
   - Calculation: $58/hour * 40 hours/week * (6-10 engineers) * 16 weeks

4. **XLarge Project**
   - Duration: 16-52 weeks (less than a year)
   - Resource Allocation: Full team of 10 engineers
   - Cost Range: $1,203,200 - $3,129,920

5. **XX Large Project**
   - Duration: More than a year
   - Resource Allocation: Full team of 10 engineers
   - Cost: More than $1,203,200

### Additional Considerations
- Include necessary roles: PMO, BA, SQE Lead
- Account for development support during testing
- Add 30% to estimates for SQE-specific tasks
- Include performance testing and automation improvements if needed