import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getOpenCases from '@salesforce/apex/AICaseDashboardController.getOpenCases';
import generateAISummary from '@salesforce/apex/AICaseDashboardController.generateAISummary';

export default class AiCaseDashboard extends LightningElement {
    @track cases = [];
    @track selectedCase = null;
    @track aiResult = null;
    @track isLoading = true;
    @track isGenerating = false;
    @track error = null;

    _wiredCasesResult;

    @wire(getOpenCases)
    wiredCases(result) {
        this._wiredCasesResult = result;
        const { data, error } = result;
        this.isLoading = false;

        if (data) {
            this.cases = data.map((caseRecord) => this.decorateCase(caseRecord));
            this.error = null;
        } else if (error) {
            this.cases = [];
            this.error = this.reduceError(error);
        }
    }

    get totalCases() {
        return this.cases.length;
    }

    get highPriorityCases() {
        return this.cases.filter((caseRecord) => caseRecord.Priority === 'High').length;
    }

    get todayCases() {
        const today = new Date();
        return this.cases.filter((caseRecord) => {
            const created = new Date(caseRecord.CreatedDate);
            return (
                created.getFullYear() === today.getFullYear() &&
                created.getMonth() === today.getMonth() &&
                created.getDate() === today.getDate()
            );
        }).length;
    }

    get hasSelectedCase() {
        return this.selectedCase !== null;
    }

    get hasAIResult() {
        return this.aiResult !== null;
    }

    get hasCases() {
        return this.cases.length > 0;
    }

    get isGenerateDisabled() {
        return this.isGenerating || !this.hasSelectedCase;
    }

    get selectedPriorityBadgeClass() {
        return this.getPriorityBadgeClass(this.selectedCase?.Priority);
    }

    get sentimentClass() {
        if (!this.aiResult || !this.aiResult.sentiment) {
            return 'sentiment-pill sentiment-neutral';
        }

        const sentiment = this.aiResult.sentiment.toLowerCase();
        if (sentiment.includes('frustrated')) {
            return 'sentiment-pill sentiment-frustrated';
        }
        if (sentiment.includes('satisfied')) {
            return 'sentiment-pill sentiment-satisfied';
        }
        return 'sentiment-pill sentiment-neutral';
    }

    handleCaseSelect(event) {
        const caseId = event.currentTarget.dataset.caseId;
        const selected = this.cases.find((caseRecord) => caseRecord.Id === caseId);

        this.selectedCase = selected || null;
        this.aiResult = null;
        this.error = null;

        this.cases = this.cases.map((caseRecord) => ({
            ...caseRecord,
            cardClass: this.buildCaseCardClass(caseRecord.Id === caseId)
        }));
    }

    handleGenerateSummary() {
        if (!this.selectedCase) {
            return;
        }

        this.isGenerating = true;
        this.error = null;
        this.aiResult = null;

        // Allow the generating state to render before the Apex call returns.
        Promise.resolve().then(() => this.runGeneration());
    }

    runGeneration() {
        generateAISummary({ caseId: this.selectedCase.Id })
            .then((response) => {
                if (response && response.startsWith('Error generating summary:')) {
                    this.error = response;
                    this.aiResult = null;
                } else {
                    this.aiResult = this.parseAIResponse(response);
                    this.error = null;
                }
            })
            .catch((err) => {
                this.error = this.reduceError(err);
                this.aiResult = null;
            })
            .finally(() => {
                this.isGenerating = false;
            });
    }

    parseAIResponse(text) {
        const emptyResult = {
            summary: '',
            sentiment: '',
            priorityAssessment: '',
            suggestedReply: '',
            nextBestAction: ''
        };

        if (!text || typeof text !== 'string') {
            return emptyResult;
        }

        const sections = {
            summary: this.extractSection(text, 'SUMMARY:', 'SENTIMENT:'),
            sentiment: this.extractSection(text, 'SENTIMENT:', 'PRIORITY ASSESSMENT:'),
            priorityAssessment: this.extractSection(text, 'PRIORITY ASSESSMENT:', 'SUGGESTED REPLY:'),
            suggestedReply: this.extractSection(text, 'SUGGESTED REPLY:', 'NEXT BEST ACTION:'),
            nextBestAction: this.extractSection(text, 'NEXT BEST ACTION:', null)
        };

        sections.sentiment = sections.sentiment.split('\n')[0].trim();
        return sections;
    }

    extractSection(text, startLabel, endLabel) {
        const startIndex = text.indexOf(startLabel);
        if (startIndex === -1) {
            return '';
        }

        const contentStart = startIndex + startLabel.length;
        const endIndex = endLabel ? text.indexOf(endLabel, contentStart) : -1;
        const rawSection = endIndex === -1 ? text.substring(contentStart) : text.substring(contentStart, endIndex);
        return rawSection.trim();
    }

    handleCopyReply() {
        if (!this.aiResult || !this.aiResult.suggestedReply) {
            return;
        }

        navigator.clipboard
            .writeText(this.aiResult.suggestedReply)
            .then(() => {
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: 'Success',
                        message: 'Copied!',
                        variant: 'success'
                    })
                );
            })
            .catch(() => {
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: 'Error',
                        message: 'Unable to copy reply.',
                        variant: 'error'
                    })
                );
            });
    }

    handleRefresh() {
        this.selectedCase = null;
        this.aiResult = null;
        this.error = null;
        this.isLoading = true;

        refreshApex(this._wiredCasesResult).finally(() => {
            this.isLoading = false;
        });
    }

    decorateCase(caseRecord) {
        return {
            ...caseRecord,
            contactDisplayName: caseRecord.Contact?.Name || 'No Contact',
            relativeTime: this.formatRelativeTime(caseRecord.CreatedDate),
            priorityBadgeClass: this.getPriorityBadgeClass(caseRecord.Priority),
            cardClass: this.buildCaseCardClass(false)
        };
    }

    buildCaseCardClass(isActive) {
        return isActive ? 'case-card active' : 'case-card';
    }

    getPriorityBadgeClass(priority) {
        if (priority === 'High') {
            return 'badge badge-high';
        }
        if (priority === 'Medium') {
            return 'badge badge-medium';
        }
        return 'badge badge-low';
    }

    formatRelativeTime(dateString) {
        if (!dateString) {
            return '';
        }

        const created = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - created.getTime();
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMinutes < 1) {
            return 'Just now';
        }
        if (diffMinutes < 60) {
            return `${diffMinutes} minutes ago`;
        }
        if (diffHours < 24) {
            return `${diffHours} hours ago`;
        }
        return `${diffDays} days ago`;
    }

    reduceError(error) {
        if (Array.isArray(error?.body)) {
            return error.body.map((item) => item.message).join(', ');
        }
        if (typeof error?.body?.message === 'string') {
            return error.body.message;
        }
        if (typeof error?.message === 'string') {
            return error.message;
        }
        return 'An unexpected error occurred.';
    }
}
