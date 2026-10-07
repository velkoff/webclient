/** @property mega.ui.KeySignatureWarningDialog
 *
 * Warning dialog when a public key's signature does not verify.
 * Triggerable with the following test code:
 * mega.ui.KeySignatureWarningDialog.singleton('4Hlf71R5IxY', 'RSA');
*/
lazy(mega.ui, 'KeySignatureWarningDialog', () => {

    'use strict';

    const ce = (n, t, a) => mCreateElement(n, a, t);

    let dialog = null;

    /**
     * Build and show the dialog.
     * @param {String} handle The contact's user handle
     * @param {String} keyType The type of key for authentication
     * @returns {void}
     */
    const render = (handle, keyType) => {
        const {sheet} = mega.ui;
        const email = M.u[handle] ? M.u[handle].m : handle;
        const emailHtml = `<span class="email">${escapeHTML(email)}</span>`;

        const messageBlock = ce('div', null, {class: 'content-block'});
        const warnWrap = ce('div', messageBlock, {class: 'contact-wrap'});

        MegaAvatarComponent.factory({
            parentNode: ce('div', warnWrap, {class: 'contact-avatar'}),
            userHandle: handle,
            size: 64
        });

        const info = ce('div', warnWrap, {class: 'info'});

        ce('span', info, {class: 'high'}).append(parseHTML(
            l[7585].replace('%1', escapeHTML(keyType)).replace('%2', emailHtml)
        ));
        ce('span', info, {class: 'normal'}).append(parseHTML(
            l[8436].replace('%1', emailHtml)
        ));

        // Footer: dismiss
        const footerNode = ce('div', null, {class: 'flex flex-row-reverse'});

        MegaButton.factory({
            parentNode: footerNode,
            text: l[148]
        }).on('click.ok', () => {
            sheet.close();
        });

        sheet.show({
            name: 'key-signature-warning-dialog',
            title: l[882],
            showClose: false,
            contents: [messageBlock],
            safeShow: !$.dialog,
            footer: {
                slot: [footerNode]
            }
        });
    };

    dialog = freeze({

        /**
         * Initialises the Key Signature Warning Dialog.
         * @param {String} contactHandle The contact's user handle
         * @param {String} keyType The type of key for authentication
         * @returns {Object} The dialog namespace
         */
        singleton(contactHandle, keyType) {
            render(contactHandle, keyType);
            return dialog;
        }
    });

    return dialog;
});
