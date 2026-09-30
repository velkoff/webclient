/** @property mega.ui.CredentialsWarningDialog
 *
* Warning dialog when there is a fingerprint mismatch e.g. a MITM attack in progress.
 * Triggerable with the following test code (change the user handle to one in your account's M.u):
 * mega.ui.CredentialsWarningDialog.singleton(
 *      '4Hlf71R5IxY',
 *      'Ed25519',
 *      'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
 *      'ABCDFF0123456789ABCDEE0123456788ABCDEF00'
 * );
*/
lazy(mega.ui, 'CredentialsWarningDialog', () => {

    'use strict';

    const ce = (n, t, a) => mCreateElement(n, a, t);

    // Queue of pending mismatches and the currently displayed one
    let dialog = null;
    let waitingList = null;
    let currentKey = null;
    let current = null;

    /**
     * Fill a container with a grouped fingerprint
     * @param {HTMLElement} container Target element
     * @param {String} fingerprint Hex fingerprint to render
     * @param {String} [other] Fingerprint to compare against for mismatches
     * @returns {void}
     */
    const fillFingerprint = (container, fingerprint, other) => {

        container.textContent = '';

        let group = null;

        for (let i = 0; i < fingerprint.length; i++) {

            if (i % 4 === 0) {
                group = ce('span', container);
            }

            const char = fingerprint.charAt(i);

            if (other && char !== other.charAt(i)) {
                ce('span', group, {class: 'mismatch'}).textContent = char;
            }
            else {
                group.appendChild(document.createTextNode(char));
            }
        }
    };

    /**
     * Build and show the dialog for the current mismatch
     * @returns {void}
     */
    const render = () => {
        const {sheet, sprites} = mega.ui;
        const {
            contactHandle: handle,
            previousFingerprint: prev,
            newFingerprint: next,
            seenOrVerified,
            contactEmail
        } = current;
        const seen = seenOrVerified === 'seen';
        const emailHtml =
            `<span class="email">${escapeHTML(contactEmail)}</span>`;

        // Avatar and warning message
        const content = ce('div', null, {class: 'content-block'});
        const warnWrap = ce('div', content, {class: 'contact-wrap'});

        MegaAvatarComponent.factory({
            parentNode: ce('div', warnWrap, {class: 'contact-avatar'}),
            userHandle: handle,
            size: 64
        });

        const info = ce('div', warnWrap, {class: 'info'});

        ce('span', info, {class: 'high'}).append(parseHTML(
            (seen ? l[6881] : l[6882]).replace('%1', emailHtml)
        ));
        info.appendChild(document.createTextNode(` ${l[7688]}`));

        // Step 1: previously seen/verified credentials
        const prevBlock = ce('div', content, {class: 'creds selectable-txt'});
        ce('p', prevBlock).textContent = `${seen ? l[6883] : l[6884]}`;
        fillFingerprint(ce('div', prevBlock, {
            class: 'fingerprint selectable-txt'
        }), prev);

        // Step 1/2: new credentials, reset and verify actions
        const detailBlock = ce('div', content, {
            class: 'highlight-bg'
        });

        const newBlock = ce('div', detailBlock, {class: 'creds'});
        ce('p', newBlock).textContent = `${l[6858]}`;
        fillFingerprint(ce('div', newBlock, {
            class: 'fingerprint selectable-txt'
        }), next, prev);

        const resetBlock = ce('div', detailBlock, {class: 'reset'});
        ce('p', resetBlock, {class: 'title'}).textContent = `${l[7689]}`;
        ce('p', resetBlock, {class: 'description'}).textContent = l[7690];

        const resetBtn = MegaButton.factory({
            parentNode: resetBlock,
            text: l[742],
            icon: `${sprites.mono} icon-sync-thin-outline`,
            componentClassname: 'reset-credentials-button'
        });

        // Step 2: shown after the credentials are reset
        const postResetBlock = ce('div', detailBlock, {
            class: 'post-reset creds hidden'
        });
        ce('p', postResetBlock).textContent = `${l[7691]}`;

        const postResetFp = ce('div', postResetBlock, {
            class: 'fingerprint selectable-txt'
        });

        const verifyBlock = ce('div', detailBlock, {
            class: 'verify-creds hidden'
        });

        ce('p', verifyBlock, {class: 'title'}).textContent = `${l.verify_credentials}:`;
        ce('p', verifyBlock, {class: 'description'}).textContent = l[7693];

        const verifyBtn = MegaButton.factory({
            parentNode: verifyBlock,
            text: `${l[1960]}...`,
            icon: `${sprites.mono} icon-check-circle-thin-solid`,
            componentClassname: 'positive verify-contact-button'
        });

        // Reset the contact's credentials and switch to the verify step
        resetBtn.on('click.reset', () => {

            authring.resetFingerprintsForUser(handle).catch(dump);

            // If they're already on the contact's page, reload the fingerprint info
            if (getSitePath() === `/fm/${handle}`) {
                showAuthenticityCredentials(M.u[handle]);
                enableVerifyFingerprintsButton(handle);
            }

            prevBlock.classList.add('hidden');
            newBlock.classList.add('hidden');
            resetBlock.classList.add('hidden');

            postResetBlock.classList.remove('hidden');
            verifyBlock.classList.remove('hidden');

            // Show the new (now un-highlighted) credentials in the post-reset section
            fillFingerprint(postResetFp, next);
        });

        // Open the regular fingerprint dialog to verify the new credentials
        verifyBtn.on('click.verify', () => {
            sheet.hide();
            fingerprintDialog(handle);
        });

        // Footer: dismiss and move to the next queued warning
        const footerNode = ce('div', null, {class: 'flex flex-row-reverse'});

        MegaButton.factory({
            parentNode: footerNode,
            text: l[148]
        }).on('click.ok', () => {
            sheet.hide();
            dialog.rendernext();
        });

        sheet.show({
            name: 'credentials-warning-dialog',
            title: l[882],
            showClose: false,
            contents: [content],
            safeShow: !$.dialog,
            footer: {
                slot: [footerNode]
            }
        });
    };

    dialog = freeze({

        /**
         * Render next warning in the waiting list.
         * @returns {void}
         */
        rendernext() {

            if (!waitingList) {
                return;
            }

            if (currentKey) {
                delete waitingList[currentKey];
            }

            const keys = Object.keys(waitingList);

            if (keys.length > 0) {
                const key = keys[0];
                dialog.singleton(
                    waitingList[key].contactHandle,
                    waitingList[key].keyType,
                    waitingList[key].prevFingerprint,
                    waitingList[key].newFingerprint
                );
            }
        },

        /**
         * Initialises the Credentials Warning Dialog
         * @param {String} contactHandle The contact's user handle
         * @param {String} keyType The key type e.g. Ed25519, RSA
         * @param {String} prevFingerprint The previous fingerprint as a hexadecimal string
         * @param {String} newFingerprint The current fingerprint as a hexadecimal string
         * @returns {Object} The dialog namespace
         */
        singleton(contactHandle, keyType, prevFingerprint, newFingerprint) {
            const {method} = u_authring[keyType][contactHandle];

            current = {
                contactHandle,
                keyType,
                contactEmail: M.u[contactHandle].m,
                seenOrVerified: method === authring.AUTHENTICATION_METHOD.SEEN
                    ? 'seen' : 'verified',
                previousFingerprint: prevFingerprint,
                newFingerprint
            };

            if (!waitingList) {
                waitingList = {};
            }

            const key = contactHandle + keyType;
            waitingList[key] = {contactHandle, keyType, prevFingerprint, newFingerprint};
            currentKey = key;

            render();

            return dialog;
        }
    });

    return dialog;
});


