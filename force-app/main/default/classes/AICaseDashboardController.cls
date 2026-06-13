public with sharing class AICaseDashboardController {

    @AuraEnabled(cacheable=true)
    public static List<Case> getOpenCases() {
        try {
            return [
                SELECT
                    Id,
                    CaseNumber,
                    Subject,
                    Description,
                    Status,
                    Priority,
                    CreatedDate,
                    Origin,
                    Contact.Name,
                    Account.Name
                FROM Case
                WHERE Status != 'Closed'
                WITH SECURITY_ENFORCED
                ORDER BY CreatedDate DESC
                LIMIT 20
            ];
        } catch (Exception e) {
            throw new AuraHandledException('Unable to load open cases: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static String generateAISummary(String caseId) {
        try {
            List<Case> cases = [
                SELECT
                    Id,
                    Subject,
                    Description,
                    Priority,
                    Status,
                    Origin,
                    Contact.Name,
                    Account.Name
                FROM Case
                WHERE Id = :caseId
                WITH SECURITY_ENFORCED
                LIMIT 1
            ];

            if (cases.isEmpty()) {
                return 'Error generating summary: Case not found.';
            }

            Case caseRecord = cases[0];
            Map<String, ConnectApi.WrappedValue> inputParams = buildInputParams(caseRecord);

            ConnectApi.EinsteinPromptTemplateGenerationsInput input =
                new ConnectApi.EinsteinPromptTemplateGenerationsInput();
            input.inputParams = inputParams;
            input.isPreview = false;
            input.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
            input.additionalConfig.applicationName = 'PromptBuilderPreview';

            ConnectApi.EinsteinPromptTemplateGenerationsRepresentation output =
                ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate('Case_AI_Summary', input);

            if (output != null && output.generations != null && !output.generations.isEmpty()) {
                return output.generations[0].text;
            }

            return buildFallbackSummary(caseRecord);
        } catch (Exception e) {
            return 'Error generating summary: ' + e.getMessage();
        }
    }

    @TestVisible
    private static Map<String, ConnectApi.WrappedValue> buildInputParams(Case caseRecord) {
        Map<String, ConnectApi.WrappedValue> inputParams = new Map<String, ConnectApi.WrappedValue>();
        putStringInput(inputParams, 'caseSubject', caseRecord.Subject);
        putStringInput(inputParams, 'caseDescription', caseRecord.Description);
        putStringInput(inputParams, 'casePriority', caseRecord.Priority);
        putStringInput(inputParams, 'caseStatus', caseRecord.Status);
        putStringInput(inputParams, 'caseContext', buildCaseContext(caseRecord));
        return inputParams;
    }

    private static void putStringInput(
        Map<String, ConnectApi.WrappedValue> inputParams,
        String apiName,
        String value
    ) {
        ConnectApi.WrappedValue wrapped = new ConnectApi.WrappedValue();
        wrapped.value = value != null ? value : '';
        inputParams.put('Input:' + apiName, wrapped);
    }

    @TestVisible
    private static String buildCaseContext(Case caseRecord) {
        String contactName = caseRecord.Contact != null ? caseRecord.Contact.Name : 'Unknown Contact';
        String accountName = caseRecord.Account != null ? caseRecord.Account.Name : 'Unknown Account';
        String origin = caseRecord.Origin != null ? caseRecord.Origin : 'Unknown';
        return 'CONTACT NAME: ' + contactName + '\nACCOUNT NAME: ' + accountName + '\nCASE ORIGIN: ' + origin;
    }

    @TestVisible
    private static String buildFallbackSummary(Case caseRecord) {
        String contactName = caseRecord.Contact != null ? caseRecord.Contact.Name : 'Customer';
        String sentiment = caseRecord.Priority == 'High' ? 'Frustrated' : 'Neutral';
        if (caseRecord.Subject != null && caseRecord.Subject.toLowerCase().contains('love')) {
            sentiment = 'Satisfied';
        }

        return 'SUMMARY:\n' +
            contactName +
            ' reported "' +
            caseRecord.Subject +
            '". ' +
            (caseRecord.Description != null ? caseRecord.Description : 'No description provided.') +
            '\n\nSENTIMENT:\n' +
            sentiment +
            '\n\nPRIORITY ASSESSMENT:\nThe current ' +
            caseRecord.Priority +
            ' priority appears appropriate given the case details and business impact described.\n\nSUGGESTED REPLY:\nDear ' +
            contactName +
            ',\n\nThank you for contacting us regarding "' +
            caseRecord.Subject +
            '". We understand how important this is and are reviewing your case now. We will follow up shortly with a clear next step and expected resolution timeline.\n\nBest regards,\nThe Support Team\n\nNEXT BEST ACTION:\nSend the reply, confirm ownership with the customer, and update the case status to Working.';
    }

    @TestVisible
    private static String buildMockAiResponse() {
        return 'SUMMARY:\nThe customer needs urgent help restoring system access for their sales team before a client presentation.\n\n' +
            'SENTIMENT:\nFrustrated\n\n' +
            'PRIORITY ASSESSMENT:\nHigh priority is appropriate because the outage affects an entire team with a same-day deadline.\n\n' +
            'SUGGESTED REPLY:\nDear Customer,\n\nThank you for reaching out. We understand how critical this is for your team ahead of your presentation. We are investigating the login issue now and will update you within the hour with next steps.\n\nBest regards,\nThe Support Team\n\n' +
            'NEXT BEST ACTION:\nEscalate to Tier 2 and confirm identity provider status immediately.';
    }
}
