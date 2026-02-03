/**
 * Language selection dialog
 */
var langDialog = {

    _CHECK_ICON_SIZE: 24,
    _CHECK_ICON: 'sprite-fm-mono icon-check-thin-outline',
    _NAMESPACE: 'language-dialog',

    /**
     * Currently selected language code.
     * Used to track the pending language selection before saving.
     *
     * @type {string|null}
     */
    _selectedLang: null,

    /**
     * List of rendered language items.
     * Used to manage active state between selections.
     *
     * @type {Array<MegaInteractable>}
     */
    _langItems: null,

    /**
     * Show the language selection dialog inside a sheet.
     *
     * @returns {void}
     */
    show() {
        'use strict';

        this._selectedLang = lang;
        this._langItems = [];

        const langCodes = this._getSortedLangCodes();
        const list = this._createLanguageList(langCodes);
        const footerElements = this._createFooter();

        mega.ui.sheet.clear();

        mega.ui.sheet.show({
            name: 'languages',
            type: 'normal',
            sheetHeight: 'auto',
            showClose: true,
            title: l[1038],
            preventBgClosing: false,
            contents: [list],
            footer: {
                slot: [footerElements]
            },
            onClose: () => {
                mega.ui.sheet.removeClass(this._NAMESPACE);
            }
        });

        mega.ui.sheet.addClass(this._NAMESPACE);
    },

    /**
     * Get the list of available language codes sorted using locale-aware comparison.
     *
     * @returns {Array<string>} Sorted language codes.
     */
    _getSortedLangCodes() {
        'use strict';

        return Object.keys(languages || {})
            .sort((a, b) => a.localeCompare(b));
    },

    /**
     * Create the list of available languages as selectable items.
     *
     * @param {Array<string>} langCodes - Sorted list of language codes.
     * @returns {HTMLElement} The generated language list element.
     */
    _createLanguageList(langCodes) {
        'use strict';

        const list = document.createElement('ul');
        list.className = 'lang-list';

        for (const code of langCodes) {
            const item = languages ? languages[code] : null;
            const nativeName = item ? item[2] : '';
            const englishName = item ? item[1] : '';

            if (!nativeName) {
                console.warn('Language %s not found...', code);
                continue;
            }

            const isSelected = code === this._selectedLang;

            const langItem = new MegaInteractable({
                parentNode: list,
                nodeType: 'li',
                type: 'normal',
                text: nativeName,
                dataset: { langCode: code },
                rightIcon: isSelected
                    ? this._CHECK_ICON
                    : false,
                rightIconSize: this._CHECK_ICON_SIZE,
                onClick: () => {
                    this._select(code, langItem);
                }
            });

            if (englishName) {
                langItem.domNode.title = englishName;
            }

            langItem.active = isSelected;
            this._langItems.push(langItem);
        }

        return list;
    },

    /**
     * Create the footer containing Save and Cancel actions.
     *
     * @returns {HTMLElement} The footer container element.
     */
    _createFooter() {
        'use strict';

        const footer = mCreateElement('div', { class: 'flex flex-row-reverse' });

        const onHide = () => {
            mega.ui.sheet.hide();
            mega.ui.sheet.removeClass(this._NAMESPACE);
        };

        const onSave = () => {
            const selected = this._selectedLang || lang;
            onHide();

            if (selected !== lang) {
                M.uiSaveLang(selected)
                    .then(() => location.reload())
                    .catch(dump);
            }
        };

        MegaButton.factory({
            parentNode: footer,
            text: l[776],
            componentClassname: 'slim font-600 primary',
            type: 'normal'
        }).on('click.langSave', onSave);

        MegaButton.factory({
            parentNode: footer,
            text: l[82],
            componentClassname: 'slim font-600 mx-2 secondary',
            type: 'normal'
        }).on('click.langCancel', onHide);

        return footer;
    },

    /**
     * Handle language selection.
     * Ensures only one item is marked as active at a time.
     *
     * @param {string} code - Selected language code.
     * @param {MegaInteractable} clickedItem - The clicked language item component.
     * @returns {void}
     */
    _select(code, clickedItem) {
        'use strict';

        if (!code || code === this._selectedLang) {
            return;
        }

        this._selectedLang = code;

        const activeItem = this._langItems.find(item => item.active);
        if (activeItem) {
            activeItem.active = false;
            activeItem.rightIcon = false;
        }

        clickedItem.active = true;
        clickedItem.rightIcon = this._CHECK_ICON;
        clickedItem.rightIconSize = this._CHECK_ICON_SIZE;
    }
};
