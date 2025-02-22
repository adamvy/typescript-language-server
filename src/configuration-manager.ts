import deepmerge from 'deepmerge';
import type * as lsp from 'vscode-languageserver';
import type tsp from 'typescript/lib/protocol.d.js';
import { LspDocuments } from './document.js';
import { CommandTypes } from './tsp-command-types.js';
import type { TypeScriptInitializationOptions } from './ts-protocol.js';
import type { TspClient } from './tsp-client.js';
import API from './utils/api.js';

const DEFAULT_TSSERVER_PREFERENCES: Required<tsp.UserPreferences> = {
    allowIncompleteCompletions: true,
    allowRenameOfImportPath: true,
    allowTextChangesInNewFiles: true,
    disableSuggestions: false,
    displayPartsForJSDoc: true,
    generateReturnInDocTemplate: true,
    importModuleSpecifierEnding: 'auto',
    importModuleSpecifierPreference: 'shortest',
    includeAutomaticOptionalChainCompletions: true,
    includeCompletionsForImportStatements: true,
    includeCompletionsForModuleExports: true,
    includeCompletionsWithClassMemberSnippets: true,
    includeCompletionsWithInsertText: true,
    includeCompletionsWithObjectLiteralMethodSnippets: true,
    includeCompletionsWithSnippetText: true,
    includeInlayEnumMemberValueHints: false,
    includeInlayFunctionLikeReturnTypeHints: false,
    includeInlayFunctionParameterTypeHints: false,
    includeInlayParameterNameHints: 'none',
    includeInlayParameterNameHintsWhenArgumentMatchesName: false,
    includeInlayPropertyDeclarationTypeHints: false,
    includeInlayVariableTypeHints: false,
    includePackageJsonAutoImports: 'auto',
    jsxAttributeCompletionStyle: 'auto',
    lazyConfiguredProjectsFromExternalProject: false,
    providePrefixAndSuffixTextForRename: true,
    provideRefactorNotApplicableReason: false,
    quotePreference: 'auto',
    useLabelDetailsInCompletionEntries: true,
};

export interface WorkspaceConfiguration {
    javascript?: WorkspaceConfigurationLanguageOptions;
    typescript?: WorkspaceConfigurationLanguageOptions;
    completions?: WorkspaceConfigurationCompletionOptions;
    diagnostics?: WorkspaceConfigurationDiagnosticsOptions;
}

export interface WorkspaceConfigurationLanguageOptions {
    format?: tsp.FormatCodeSettings;
    inlayHints?: TypeScriptInlayHintsPreferences;
}

export interface TypeScriptInlayHintsPreferences {
    includeInlayParameterNameHints?: 'none' | 'literals' | 'all';
    includeInlayParameterNameHintsWhenArgumentMatchesName?: boolean;
    includeInlayFunctionParameterTypeHints?: boolean;
    includeInlayVariableTypeHints?: boolean;
    includeInlayPropertyDeclarationTypeHints?: boolean;
    includeInlayFunctionLikeReturnTypeHints?: boolean;
    includeInlayEnumMemberValueHints?: boolean;
}

interface WorkspaceConfigurationDiagnosticsOptions {
    ignoredCodes?: number[];
}

export interface WorkspaceConfigurationCompletionOptions {
    completeFunctionCalls?: boolean;
}

export class ConfigurationManager {
    public tsPreferences: Required<tsp.UserPreferences> = deepmerge({}, DEFAULT_TSSERVER_PREFERENCES);
    public workspaceConfiguration: WorkspaceConfiguration = {};
    private tspClient: TspClient | null = null;

    constructor(private readonly documents: LspDocuments) {}

    public mergeTsPreferences(preferences: tsp.UserPreferences): void {
        this.tsPreferences = deepmerge(this.tsPreferences, preferences);
    }

    public setWorkspaceConfiguration(configuration: WorkspaceConfiguration): void {
        this.workspaceConfiguration = configuration;
    }

    public async setAndConfigureTspClient(client: TspClient, hostInfo?: TypeScriptInitializationOptions['hostInfo']): Promise<void> {
        this.tspClient = client;
        const formatOptions: tsp.FormatCodeSettings = {
            // We can use \n here since the editor should normalize later on to its line endings.
            newLineCharacter: '\n',
        };
        const args: tsp.ConfigureRequestArguments = {
            ...hostInfo ? { hostInfo } : {},
            formatOptions,
            preferences: this.tsPreferences,
        };
        await this.tspClient?.request(CommandTypes.Configure, args);
    }

    public async configureGloballyFromDocument(filename: string, formattingOptions?: lsp.FormattingOptions): Promise<void> {
        const args: tsp.ConfigureRequestArguments = {
            formatOptions: this.getFormattingOptions(filename, formattingOptions),
            preferences: this.getPreferences(filename),
        };
        await this.tspClient?.request(CommandTypes.Configure, args);
    }

    public getPreferences(filename: string): tsp.UserPreferences {
        if (this.tspClient?.apiVersion.lt(API.v290)) {
            return {};
        }

        const workspacePreferences = this.getWorkspacePreferencesForFile(filename);
        const preferences = Object.assign<tsp.UserPreferences, tsp.UserPreferences, tsp.UserPreferences>(
            {},
            this.tsPreferences,
            workspacePreferences?.inlayHints || {},
        );

        return {
            ...preferences,
            quotePreference: this.getQuoteStylePreference(preferences),
        };
    }

    private getFormattingOptions(filename: string, formattingOptions?: lsp.FormattingOptions): tsp.FormatCodeSettings {
        const workspacePreferences = this.getWorkspacePreferencesForFile(filename);

        const opts: tsp.FormatCodeSettings = {
            ...workspacePreferences?.format,
            ...formattingOptions,
        };

        if (opts.convertTabsToSpaces === undefined) {
            opts.convertTabsToSpaces = formattingOptions?.insertSpaces;
        }
        if (opts.indentSize === undefined) {
            opts.indentSize = formattingOptions?.tabSize;
        }

        return opts;
    }

    private getQuoteStylePreference(preferences: tsp.UserPreferences) {
        switch (preferences.quotePreference) {
            case 'single': return 'single';
            case 'double': return 'double';
            default: return this.tspClient?.apiVersion.gte(API.v333) ? 'auto' : undefined;
        }
    }

    private getWorkspacePreferencesForFile(filename: string): WorkspaceConfigurationLanguageOptions {
        const document = this.documents.get(filename);
        const languageId = document?.languageId.startsWith('typescript') ? 'typescript' : 'javascript';
        return this.workspaceConfiguration[languageId] || {};
    }
}
