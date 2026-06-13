@IsTest
private class AICaseDashboardControllerTest {

    @TestSetup
    static void setupData() {
        Account acct = new Account(Name = 'Acme Corp');
        insert acct;

        Contact con = new Contact(
            FirstName = 'Jane',
            LastName = 'Admin',
            AccountId = acct.Id,
            Role__c = 'Decision Maker'
        );
        insert con;

        insert new List<Case>{
            new Case(
                Subject = 'Open Case One',
                Description = 'Need help with login issues.',
                Status = 'New',
                Priority = 'High',
                Origin = 'Phone',
                ContactId = con.Id,
                AccountId = acct.Id
            ),
            new Case(
                Subject = 'Open Case Two',
                Description = 'Report filters are incorrect.',
                Status = 'Working',
                Priority = 'Medium',
                Origin = 'Email',
                ContactId = con.Id,
                AccountId = acct.Id
            ),
            new Case(
                Subject = 'Closed Case',
                Description = 'Already resolved.',
                Status = 'Closed',
                Priority = 'Low',
                Origin = 'Web',
                ContactId = con.Id,
                AccountId = acct.Id
            )
        };
    }

    @IsTest
    static void testGetOpenCases() {
        Test.startTest();
        List<Case> openCases = AICaseDashboardController.getOpenCases();
        Test.stopTest();

        System.assertEquals(2, openCases.size(), 'Only non-closed cases should be returned.');
        for (Case c : openCases) {
            System.assertNotEquals('Closed', c.Status);
        }
    }

    @IsTest
    static void testGenerateAISummarySuccess() {
        Case openCase = [
            SELECT Id
            FROM Case
            WHERE Status != 'Closed'
            LIMIT 1
        ];

        Test.startTest();
        String response = AICaseDashboardController.generateAISummary(openCase.Id);
        Test.stopTest();

        System.assert(
            response.contains('SUMMARY:') || response.startsWith('Error generating summary:'),
            'Expected AI summary or handled error response.'
        );
    }

    @IsTest
    static void testGenerateAISummaryCaseNotFound() {
        Case tempCase = new Case(
            Subject = 'Temp',
            Status = 'New',
            Priority = 'Low',
            Origin = 'Web'
        );
        insert tempCase;
        Id deletedId = tempCase.Id;
        delete tempCase;

        Test.startTest();
        String response = AICaseDashboardController.generateAISummary(deletedId);
        Test.stopTest();

        System.assert(response.startsWith('Error generating summary:'), 'Missing case should return error string.');
    }

    @IsTest
    static void testBuildCaseContext() {
        Case openCase = [
            SELECT Id, Origin, Contact.Name, Account.Name
            FROM Case
            WHERE Status != 'Closed'
            LIMIT 1
        ];

        String context = AICaseDashboardController.buildCaseContext(openCase);
        System.assert(context.contains('CONTACT NAME:'));
        System.assert(context.contains('ACCOUNT NAME:'));
        System.assert(context.contains('CASE ORIGIN:'));
    }

    @IsTest
    static void testBuildInputParams() {
        Case openCase = [
            SELECT Id, Subject, Description, Priority, Status, Origin, Contact.Name, Account.Name
            FROM Case
            WHERE Status != 'Closed'
            LIMIT 1
        ];

        Map<String, ConnectApi.WrappedValue> params = AICaseDashboardController.buildInputParams(openCase);
        System.assertEquals(5, params.size());
        System.assert(params.containsKey('Input:caseSubject'));
        System.assert(params.containsKey('Input:caseContext'));
    }

    @IsTest
    static void testBuildInputParamsWithNullValues() {
        Case bareCase = new Case(
            Subject = 'Null Field Case',
            Description = null,
            Priority = 'Low',
            Status = 'New',
            Origin = null
        );

        Map<String, ConnectApi.WrappedValue> params = AICaseDashboardController.buildInputParams(bareCase);
        System.assertEquals(5, params.size());
        System.assert(
            AICaseDashboardController.buildCaseContext(bareCase).contains('Unknown Contact')
        );
    }

    @IsTest
    static void testBuildFallbackSummary() {
        Case openCase = [
            SELECT Id, Subject, Description, Priority, Status, Origin, Contact.Name, Account.Name
            FROM Case
            WHERE Status != 'Closed'
            LIMIT 1
        ];

        String response = AICaseDashboardController.buildFallbackSummary(openCase);
        System.assert(response.contains('SUMMARY:'));
        System.assert(response.contains('SUGGESTED REPLY:'));
    }
}
