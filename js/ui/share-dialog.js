/** @property mega.ui.mShareDialog */
lazy(mega.ui, 'mShareDialog', () => {

    'use strict';

    // Share permission dropdown options
    const PERMISSION_ITEMS = [
        {id: 'read-only', name: l[55], sub: l.share_permission_readonly_description},
        {id: 'read-write', name: l[56], sub: l.share_permission_readwrite_description},
        {id: 'full', name: l[57], sub: l.share_permission_fullaccess_description}
    ];

    // Map between the API permission level and the dropdown item id
    const PERMISSION_ID = ['read-only', 'read-write', 'full'];
    const PERMISSION_LEVEL = {'read-only': 0, 'read-write': 1, 'full': 2};

    // Maximum number of "ungrouped" shared contacts shown
    const ACCESS_LIST_LIMIT = 4;

    const ce = (n, t, a) => mCreateElement(n, a, t);

    const sheet = new MegaSheet({
        parentNode: document.body,
        componentClassname: 'mega-sheet share-dialog',
        wrapperClassname: 'sheet'
    });

    class ShareDialog {
        constructor(target) {
            this.h = target;
            this.node = null;
            this.name = 'share';
            this.expanded = false;

            this.dom = Object.create(null);
            this.state = Object.create(null);
        }

        async init() {
            const {h} = this;

            if (!M.d[h]) {
                await dbfetch.get(h);
            }

            const node = M.getNodeByHandle(h);
            this.node = node;
            assert(node);
        }

        async show() {
            await this.init().catch(dump);

            this.buildContent();
            this.buildFooter();

            const cv = mega.keyMgr.getWarningValue('cv') !== false;

            // One-time contact-verification reminder
            this.cvbBanner = !cv && u_attr.since < 1697184000
                && !mega.keyMgr.getWarningValue('cvb');

            if (this.cvbBanner) {
                mega.keyMgr.setWarningValue('cvb', '1');
            }

            this.renderAccessList();

            sheet.show({
                name: this.name,
                showClose: true,
                type: 'base',
                contents: [
                    this.dom.content
                ],
                footer: {
                    slot: [this.dom.footer]
                },
                onShow: () => {
                    this._setEditing(false);
                },
                onClose: () => {
                    delete $.sharedTokens;
                    delete $.contactPickerSelected;
                    delete $.addContactsToShare;
                    delete $.changedPermissions;
                    delete $.removedContactsFromShare;
                    delete $.shareDialog;
                },
                // Warn about unsaved changes on the close (X) button.
                confirmClose: () => this._confirmClose(),
                onEscape: ev => {
                    // Handle Escape only when this is the topmost sheet
                    if (ev.key === 'Escape' && sheet.visible && !mega.ui.sheet.visible) {
                        ev.stopPropagation();
                        this._confirmClose().then((ok) => {
                            if (ok) {
                                this._close();
                            }
                        }).catch(dump);
                    }
                },
            });
        }

        /**
         * Close the dialog and clean up its state.
         * @returns {void}
         */
        _close() {
            sheet.trigger('close');
            sheet.hide();
        }

        /**
         * Check pending chips to invite, or per-contact edits not yet applied
         * @returns {Boolean} True when there are unsaved changes
         */
        _hasUnsavedChanges() {
            return !!(
                this.chips && this.chips.values().length
                || Object.keys($.changedPermissions || {}).length
                || Object.keys($.removedContactsFromShare || {}).length
            );
        }

        /**
         * Confirm closing is there are unsaved changes
         * @returns {Promise<Boolean>} Resolve true when it's safe to close
         */
        _confirmClose() {
            return new Promise((resolve) => {
                if (!this._hasUnsavedChanges()) {
                    resolve(true);
                    return;
                }

                msgDialog('confirmation', '', l[24208], l[18229], (e) => resolve(!!e));
            });
        }

        buildContent() {
            this.dom.content = ce('div', [
                this.buildSharedItem(),
                this.dom.addContacts = ce('div', [
                    this.buildInviteBlock(),
                    this.buildPermissions()
                ], {
                    class: 'add-contacts'
                }),
                this.buildInviteNote(),
                this.dom.subHeader = ce('p', null, {class: 'sub-header'}),
                this.dom.banner = ce('div', null, {class: 'share-banner hidden'}),
                this.buildAccessList()
            ], {
                class: 'share-dialog-content'
            });
        }

        buildSharedItem() {
            const {node} = this;
            const {name = '', td, tf} = node;
            const wrap = ce('div', null, {class: 'info-wrap'});

            ce('i', wrap, {class: `item-type-icon-90 icon-${folderIcon(node)}-90`});

            const info = ce('div', wrap, {class: 'info'});
            ce('div', info, {class: 'name', title: name}).textContent = name;
            ce('div', info, {class: 'contains'}).textContent =
                fm_contains(tf, td, true).replace(/<br\s*\/?>/g, ' \u00B7 ');

            return wrap;
        }

        buildInviteBlock() {
            const wrap = ce('div', null, {class: 'contacts-chips'});

            const chips = this.chips = new MegaChipEditor({
                parentNode: wrap,
                placeholder: l.share_add_contact_placeholder,
                validate: email => this._validateInvitee(email),
                avatars: true,
                simpletip: true,
                // Resolve a chip's display name + avatar handle from its email
                resolve: (email) => {
                    const user = M.getUserByEmail(email);

                    return user && {name: M.getNameByHandle(user.h), handle: user.h};
                },
            });

            const dropdown = new MegaDropdown({
                parentNode: wrap,
                componentClassname: 'no-wrap',
                position: 'attached'
            });

            const listOfContacts = M.getContactsEMails(true);

            // The event is the first argument; the input value is the second
            chips.on('input', (ev, value) => {
                if (!value) {
                    return;
                }

                dropdown.hide();

                const query = value.trim().toLowerCase();

                if (!query || !listOfContacts.length) {
                    return;
                }

                // Exclude emails already in the chips or already in the access list.
                const chosen = new Set(
                    [...chips.values(), ...this._accessEmails()].map(e => String(e).toLowerCase())
                );

                const matches = listOfContacts.filter(c =>
                    !chosen.has(String(c.id).toLowerCase())
                    && (c.name && c.name.toLowerCase().includes(query)
                        || c.id && c.id.toLowerCase().includes(query)));

                if (!matches.length) {
                    return;
                }

                dropdown.show({
                    target: chips.domNode,
                    items: matches,
                });
            });

            chips.on('keys', (ev, e) => {
                if (!dropdown.visible) {
                    return;
                }

                switch (e.key) {
                    case 'ArrowDown':
                        dropdown.selectNext();
                        e.preventDefault();
                        break;

                    case 'ArrowUp':
                        dropdown.selectPrev();
                        e.preventDefault();
                        break;

                    case 'Enter':
                        // Nothing highlighted yet - pick the first suggestion
                        if (dropdown.selected < 0) {
                            dropdown.selectNext();
                        }
                        dropdown.confirm();
                        e.preventDefault();
                        break;

                    case 'Escape':
                        dropdown.hide();
                        break;
                }
            });

            chips.on('commit', () => {
                dropdown.hide();
            });

            // Update the Share button when chips change
            chips.on('change', () => this._updateShareButton());

            // Enter invite mode when the field is focused
            chips.anchorNode.addEventListener('focus', () => this._setEditing(true));

            // On blur, commit the typed value as if Enter was pressed
            chips.anchorNode.addEventListener('blur', () => {
                if (dropdown.visible) {
                    if (dropdown.selected < 0) {
                        dropdown.selectNext();
                    }
                    dropdown.confirm();
                }
                else {
                    chips.commit(false);
                }
            });

            dropdown.on('select', (ev, contact) => {
                chips.add(contact.email || contact.id);

                chips.clearInput();
                chips.focus();
                dropdown.hide();
            });

            return wrap;
        }

        _scrollTop() {
            sheet.scrollTo(sheet.contentNode);
        }

        _updateScroll() {
            sheet.updateScrollbar();
        }

        /**
         * Toggle the invite/editing view
         * @param {Boolean} editing Is chips input focued, i.e. is Editing mode
         * @returns {void}
         */
        _setEditing(editing) {
            if (editing) {
                if (this.editingMode) {
                    return;
                }

                this.editingMode = true;
                sheet.addHeader(l[5631]);
                sheet.addBackBtn(() => this._setEditing());
            }
            else {
                this.editingMode = false;
                sheet.addHeader(M.isOutShare(this.node, 'EXP') ? l.manage_share : l[5631]);
                sheet.clearBackBtn();
            }

            this.dom.permissions.classList.toggle('hidden', !editing);
            this.dom.inviteNote.classList.toggle('hidden', !editing);
            this.dom.accessList.classList.toggle('hidden', editing);
            this.dom.subHeader.classList.toggle('hidden', editing || !this._hasOtherAccess());
            this.dom.footer.closest('footer').classList.remove('hidden');

            this.dom.shareBtn[editing ? 'show' : 'hide']();
            this.dom.doneBtn[editing ? 'hide' : 'show']();
            this.dom.removeShare[editing || !M.isOutShare(this.node, 'EXP') ? 'hide' : 'show']();

            if (editing) {
                // Banners belong to the default view only
                this.dom.banner.classList.add('hidden');

                Ps.initialize(this.inviteNote.heightNode);
                this._updateShareButton();
            }
            else {
                // Restore the default-view banner that was hidden while editing
                this.renderAccessList();
            }

            this._scrollTop();
            this._updateScroll();
        }

        /**
         * Invite the entered emails to the share at the selected permission
         * @returns {Boolean} True if an invite was started.
         */
        invite() {
            const emails = this.chips.values();

            if (!emails.length) {
                return false;
            }

            this._inviteContacts(emails, this.inviteNote.value);
            return true;
        }

        /**
         * Clear the invite fields and return to the default view after a share completes
         * @returns {void}
         */
        _resetInvite() {
            this.chips.clear();
            this.inviteNote.value = '';

            if (this.permission) {
                this.permission.setValue('read-only');
            }

            this._setEditing(false);
        }

        /**
         * Invite the entered email addresses
         * Warn for non-contacts and unverified contacts before sharing
         * @param {String[]} emails Emails to invite.
         * @param {String} inviteNote Optional invitation note.
         * @returns {void}
         */
        _inviteContacts(emails, inviteNote) {
            const currentContactsEmails = [];
            const nonContactEmails = [];

            for (const contact of Object.values(M.u)) {
                if (contact.c === 1 && contact.m) {
                    currentContactsEmails.push(contact.m);
                }
            }

            for (const email of emails) {
                if (!currentContactsEmails.includes(email)
                    && !M.findOutgoingPendingContactIdByEmail(email)) {

                    nonContactEmails.push(email);
                }
            }

            const unverified = this._getUnverifiedContacts(
                nonContactEmails, emails
            );

            // Warn before inviting non-contacts
            if (nonContactEmails.length > 0) {
                msgDialog(
                    `*warningb:!^${l.share_confirm_dialog_proceed}!${l.msg_dlg_cancel}`,
                    '',
                    escapeHTML(l.share_confirm_dialog_title),
                    `<span class="break-word">${escapeHTML(mega.utils.trans.listToString(
                        nonContactEmails, l.share_add_non_contact_warning_msg
                    ))}</span>`,
                    (res) => {
                        if (res || res === null) {
                            return;
                        }

                        if (unverified.length) {
                            this._confirmUnverifiedShare(
                                unverified, nonContactEmails, emails, inviteNote
                            );
                        }
                        else {
                            this._addContactsToShare(
                                nonContactEmails, emails, inviteNote
                            );
                        }
                    }
                );
            }
            else if (unverified.length) {
                this._confirmUnverifiedShare(
                    unverified, nonContactEmails, emails, inviteNote
                );
            }
            else {
                this._addContactsToShare(
                    nonContactEmails, emails, inviteNote
                );
            }
        }

        /**
         * Get unverified contacts when verification reminders are enabled
         * @param {String[]} nonContactEmails Email addresses that are not contacts
         * @param {String[]} emails Email addresses to check
         * @returns {Object[]} Unverified user objects
         */
        _getUnverifiedContacts(nonContactEmails, emails) {
            if (mega.keyMgr.getWarningValue('cv') !== '1') {
                return [];
            }

            const unverified = [];

            for (const email of emails) {
                if (nonContactEmails.includes(email) || M.findOutgoingPendingContactIdByEmail(email)) {
                    continue;
                }

                const user = M.getUserByEmail(email);
                const ed = authring.getContactAuthenticated(user.h, 'Ed25519');

                if (!(ed && ed.method >= authring.AUTHENTICATION_METHOD.FINGERPRINT_COMPARISON)) {
                    unverified.push(user);
                }
            }

            return unverified;
        }

        /**
         * Warn that some recipients are unverified
         * Share without verifying or verify a contact and re-check the rest
         * @param {Object[]} unverified Unverified contacts
         * @param {String[]} nonContactEmails Non-contact email addresses
         * @param {String[]} emails Email addresses to invite
         * @param {String} inviteNote Optional invitation note
         * @returns {void}
         */
        _confirmUnverifiedShare(unverified, nonContactEmails, emails, inviteNote) {

            msgDialog(
                `*warningb:!^${l.share_without_verifying_button}!${l.verify_credentials}`,
                '',
                l.share_unverified_dialog_title,
                l.share_unverified_dialog_desc.replace(/\[A]|\[\/A]/g, ''),
                (res) => {

                    // Share without verifying
                    if (res === false) {
                        this._addContactsToShare(nonContactEmails, emails, inviteNote);
                        return;
                    }

                    // Verify credentials: verify the first unverified contact,
                    // then re-check the rest (or share once none remain).
                    if (res === true && unverified[0]) {
                        fingerprintDialog(unverified[0].h, false, () => {

                            const remaining = this._getUnverifiedContacts(nonContactEmails, emails);

                            if (remaining.length) {
                                this._confirmUnverifiedShare(remaining, nonContactEmails, emails, inviteNote);
                            }
                            else {
                                this._addContactsToShare(nonContactEmails, emails, inviteNote);
                            }
                        });
                    }
                }
            );
        }

        /**
         * Selected permission level for new invitees: 0 read-only, 1 read-write, 2 full
         * @returns {Number} Permission level
         */
        _permissionLevel() {
            if (M.currentrootid === M.InboxID || M.getNodeRoot(this.h) === M.InboxID) {
                return 0;
            }

            if (this.permission) {
                return {'read-write': 1, 'full': 2}[this.permission.getValue()] | 0;
            }

            return 0;
        }

        /**
         * Invite any non-contacts, then add every recipient to the share
         * @param {String[]} nonContactEmails Non-contact email addresses
         * @param {String[]} emails Email addresses to share
         * @param {String} inviteNote Optional invitation note
         * @returns {void}
         */
        _addContactsToShare(nonContactEmails, emails, inviteNote) {
            const promises = [];
            const addedEmails = [];
            const currentUserEmail = M.u[u_handle].m;

            loadingDialog.show('add-contacts-to-share');

            for (const email of nonContactEmails) {
                promises.push(
                    M.inviteContact(currentUserEmail, email, inviteNote).then((res) => addedEmails.push(res))
                );
            }

            Promise.allSettled(promises).always(() => {

                const permissionLevel = this._permissionLevel();

                for (const email of emails) {
                    const user = M.getUserByEmail(email);
                    const handle = user ? user.h : M.findOutgoingPendingContactIdByEmail(email);

                    $.addContactsToShare[handle] = {u: email, r: permissionLevel, msg: inviteNote};
                }

                new mega.Share().updateNodeShares(this.h)
                    .then(() => {

                        this._resetInvite();

                        $.addContactsToShare = {};
                        $.removedContactsFromShare = {};
                        $.changedPermissions = {};

                        if (addedEmails.length) {
                            const title = mega.icu.format(l.contacts_invited_title, addedEmails.length);
                            const message = addedEmails.length === 1 ? l[5898] : l[5899];

                            contactsInfoDialog(title, '', message);
                        }

                        this.renderAccessList();
                        showToast('view', l.share_toast_success);
                    })
                    .catch(() => {
                        showToast('warning', l[47]);
                    })
                    .finally(() => {
                        loadingDialog.hide('add-contacts-to-share');
                    });
            });
        }

        buildInviteNote() {
            const wrap = this.dom.inviteNote = ce('div', null, {class: 'invite-note'});

            this.inviteNote = new MegaTextArea({
                parentNode: wrap,
                placeholder: l.share_dlg_note,
                maxLength: 800
            });

            return wrap;
        }

        /**
         * Backup(Inbox) are read-only, permission selectors are locked
         * @returns {Boolean} True if Backups
         */
        get readonly() {
            return M.currentrootid === M.InboxID || M.getNodeRoot(this.h) === M.InboxID;
        }

        buildPermissions() {
            const wrap = this.dom.permissions = ce('div', null, {
                class: 'permissions'
            });

            // Read-only folder: no permission choice, show a static label.
            if (this.readonly) {
                wrap.classList.add('permissions-readonly');
                wrap.textContent = l[55];
                return wrap;
            }

            this.permission = new MegaDropdown({
                parentNode: wrap,
                select: true,
                value: 'read-write',
                showCheck: true,
                position: 'right',
                items: PERMISSION_ITEMS
            });

            return wrap;
        }

        buildAccessList() {
            this.dom.accessList = ce('div', null, {class: 'access-list'});
            this.dom.subHeader.textContent = l.share_dlg_access_hdr;

            this.renderAccessList();

            return this.dom.accessList;
        }

        /**
         * Build the access list
         * @returns {void}
         */
        renderAccessList() {
            const list = this.dom.accessList;

            list.textContent = '';

            const rows = this._collectAccessRows();
            const owner = rows.find(r => r.owner);
            const contacts = rows.filter(r => !r.owner);
            const hasContacts = contacts.length > 0;

            // Hide the owner row and the "Access" header when the folder isn't shared with anyone else
            this.dom.subHeader.classList.toggle('hidden', this.editingMode || this.expanded || !hasContacts);

            if (owner && hasContacts) {
                this._renderAccessRow(list, owner);
            }

            const groupedContacts = this.expanded ? [] : contacts.slice(ACCESS_LIST_LIMIT - 1);

            // Only collapse into a group when it actually hides more than one
            // contact ,  a group of a single contact wastes the same space.
            if (groupedContacts.length > 1) {
                for (const row of contacts.slice(0, ACCESS_LIST_LIMIT - 1)) {
                    this._renderAccessRow(list, row);
                }

                this._renderAccessGroup(list, groupedContacts);
            }
            else {
                for (const row of contacts) {
                    this._renderAccessRow(list, row);
                }
            }

            this._updateBanners(contacts);
            this._updateSaveButton();
            this._updateScroll();
        }

        /**
         * Show the backup read-only warning, or the contact-verification banners
         * @param {Object[]} contacts The non-owner access rows.
         * @returns {void}
         */
        _updateBanners(contacts) {
            const {banner} = this.dom;

            banner.textContent = '';
            banner.classList.add('hidden');

            // Banners belong to the default view only (hidden while editing / in the expanded list).
            // Controlled here in JS so the banner no longer depends on the sub-header being visible.
            if (this.editingMode || this.expanded) {
                return;
            }

            // Backup(Inbox) folders: read-only warning with an info tooltip
            if (this.readonly) {
                banner.classList.remove('hidden');
                banner.appendChild(parseHTML(l.backup_read_only_wrng));

                ce('i', banner.querySelector('span'), {
                    class: 'sprite-fm-mono icon-info-filled simpletip',
                    'data-simpletip': l.backup_read_only_info,
                    'data-simpletipposition': 'top'
                });

                return;
            }

            const cv = mega.keyMgr.getWarningValue('cv') !== false;

            // One-time reminder to enable contact-verification
            if (this.cvbBanner && !cv) {
                banner.classList.remove('hidden');

                const [before, link, after] = l.contact_verification_notif_banner.split(/\[D]|\[\/D]/);
                const linkNode = ce('a');

                linkNode.textContent = link;
                linkNode.onclick = (ev) => {
                    ev.preventDefault();
                    loadSubPage('fm/account/contact-chats/contact-verification-settings');
                };

                banner.append(
                    document.createTextNode(before),
                    linkNode,
                    document.createTextNode(after)
                );
            }
            // Warn when the list contains unverified contacts
            else if (cv && contacts.some(c => c.unverified)) {
                banner.classList.remove('hidden');
                banner.textContent = l.undec_outshare_warning_banner;
            }
        }

        /**
         * Save / Done button update
         * @returns {void}
         */
        _updateSaveButton() {
            if (!this.dom.doneBtn) {
                return;
            }

            const hasChanges = Object.keys($.changedPermissions || {}).length
                || Object.keys($.removedContactsFromShare || {}).length;

            this.dom.doneBtn.text = hasChanges ? l[776] : l[726];
        }

        /**
         * Enable the Share button only when there is at least one chip
         * @returns {void}
         */
        _updateShareButton() {
            if (this.dom.shareBtn) {
                this.dom.shareBtn.disabled = !this.chips.values().length;
            }
        }

        /**
         * Toggle the expanded collaborators (acccess list)
         * @param {Boolean} expanded True for full list (ex. collaborations dialog)
         * @returns {void}
         */
        _setExpanded(expanded) {
            this.expanded = expanded;

            if (expanded) {
                sheet.addHeader(l.share_dlg_access_hdr);
                sheet.addBackBtn(() => this._setExpanded(false));

                this.dom.addContacts.classList.add('hidden');
                this.dom.inviteNote.classList.add('hidden');
                this.dom.subHeader.classList.add('hidden');
                this.dom.accessList.classList.remove('hidden');
                this.dom.footer.closest('footer').classList.add('hidden');

                this.dom.shareBtn.hide();
                this.dom.doneBtn.show();
                this.dom.removeShare[M.isOutShare(this.node, 'EXP') ? 'show' : 'hide']();

                this.renderAccessList();
            }
            else {
                this.dom.addContacts.classList.remove('hidden');

                // Restores the default view
                this._setEditing(false);

                this.renderAccessList();
            }

            this._scrollTop();
        }

        _collectAccessRows() {
            const rows = [];

            // Folder owner first (no controls)
            const owner = this._ownerRow();
            if (owner) {
                rows.push(owner);
            }

            // Existing shared contacts (excluding the owner and removed ones)
            for (const handle of Object.keys(M.getOutShares(this.h, 'EXP') || {})) {
                const row = this._shareRow(handle);
                if (row) {
                    rows.push(row);
                }
            }

            // Not-yet-committed additions
            for (const handle of Object.keys($.addContactsToShare || {})) {
                const row = this._addedRow(handle);
                if (row) {
                    rows.push(row);
                }
            }

            return rows;
        }

        _ownerRow() {
            if (typeof u_attr === 'undefined' || !u_attr) {
                return null;
            }

            return {handle: u_attr.u, name: u_attr.name, email: u_attr.email, level: 2, owner: true};
        }

        _shareRow(handle) {
            const added = $.addContactsToShare || {};
            const removed = $.removedContactsFromShare || {};

            if (handle === (u_attr && u_attr.u) || removed[handle] || added[handle]) {
                return null;
            }

            const user = M.getUser(handle) || M.opc[handle];

            if (!user) {
                return null;
            }

            const share = M.getNodeShare(this.node, handle) || {};
            const changed = $.changedPermissions || {};

            return {
                handle,
                firstName: user.firstName,
                name: M.getNameByHandle(handle) || user.m,
                email: user.m,
                level: changed[handle] ? changed[handle].r : share.r | 0,
                pending: !!share.p,
                unverified: this._isUnverified(handle)
            };
        }

        _addedRow(handle) {
            if (($.removedContactsFromShare || {})[handle]) {
                return null;
            }

            const {u: email, r} = $.addContactsToShare[handle];

            return {
                handle,
                name: M.getNameByHandle(handle) || email,
                email,
                level: r,
                pending: !!M.opc[handle] || String(handle).startsWith('#new_'),
                unverified: this._isUnverified(handle)
            };
        }

        /**
         * Check whether a contact requires credential verification
         * @param {String} handle Contact handle
         * @returns {Boolean} True if verification is required
         */
        _isUnverified(handle) {
            if (mega.keyMgr.getWarningValue('cv') !== '1') {
                return false;
            }

            const ed = authring.getContactAuthenticated(handle, 'Ed25519');

            return !(ed && ed.method >= authring.AUTHENTICATION_METHOD.FINGERPRINT_COMPARISON);
        }

        /**
         * Get email addresses already present in the access list
         * @returns {String[]} Access list email addresses.
         */
        _accessEmails() {
            return this._collectAccessRows().map(r => r.email).filter(Boolean);
        }

        /**
         * Whether the folder is shared with anyone other than the owner
         * @returns {Boolean} True if there are non-owner access rows
         */
        _hasOtherAccess() {
            return this._collectAccessRows().some(r => !r.owner);
        }

        /**
         * Validate an email before adding it as a chip
         * @param {String} email Email address to validate
         * @returns {Boolean|String} True if valid, otherwise an error message
         */
        _validateInvitee(email) {
            const lower = String(email).toLowerCase();

            if (typeof isValidEmail === 'function' && !isValidEmail(email)) {
                return false;
            }

            if (M.u[u_handle] && lower === String(M.u[u_handle].m).toLowerCase()) {
                return l.share_add_own_email_error;
            }

            if (this.chips.values().some(v => String(v).toLowerCase() === lower)) {
                return l.email_address_already_entered;
            }

            if (this._accessEmails().some(e => String(e).toLowerCase() === lower)) {
                return l.share_add_contact_already_shared_error;
            }

            return true;
        }

        _renderAccessRow(list, row) {
            const {pending, unverified, handle, owner, email, level} = row;
            const {readonly} = this;
            const node = ce('div', list, {class: 'access-node'});

            if (pending) {
                node.classList.add('pending');
            }
            else if (unverified) {
                node.classList.add('unverified-contact');
            }

            if (handle && typeof MegaAvatarComponent !== 'undefined') {
                MegaAvatarComponent.factory({
                    parentNode: ce('div', node, {class: 'access-avatar'}),
                    userHandle: handle,
                    size: 32
                });
            }

            const info = ce('div', node, {class: 'access-info'});

            let {name} = row;

            if (owner) {
                name = `${name} (${l[8885]})`;
            }
            else if (pending) {
                name = l.contact_request_pending.replace('%1', name);
            }

            const nameNode = ce('div', info, {class: 'access-name'});

            // The owner has no editable permission and cannot be removed
            if (owner) {
                ce('span', nameNode).textContent = name;
                ce('div', node, {class: 'access-owner'}).textContent = l[5905];
                return;
            }

            ce('span', nameNode, {
                class: 'simpletip',
                'data-simpletip': email,
                'data-simpletipposition': 'top'
            }).textContent = name;

            // Unverified contacts get a "Verify credentials" button
            if (unverified && !pending) {
                const verify = ce('button', node, {
                    class: 'access-verify',
                    type: 'button'
                });

                verify.textContent = l.verify_credentials;
                verify.addEventListener('click', () =>
                    fingerprintDialog(handle, false, () => this.renderAccessList()));
            }

            // Read-only folder: permission is fixed, show a static label
            if (readonly) {
                ce('div', node, {class: 'access-permission-static'}).textContent = l[55];
            }
            else {
                new MegaDropdown({
                    parentNode: node,
                    select: true,
                    selectClassname: 'ghost sm-size',
                    showCheck: true,
                    position: 'right',
                    value: PERMISSION_ID[level] || 'read-only',
                    items: PERMISSION_ITEMS
                }).on('select', (ev, item) =>
                    this._changePermission(row, PERMISSION_LEVEL[item.id]));
            }

            const remove = ce('button', node, {
                class: 'access-remove',
                type: 'button'
            });

            ce('i', remove, {
                class: `${mega.ui.sprites.mono} icon-dialog-close-thin`
            });

            remove.addEventListener('click', () => this._removeAccess(row));
        }

        _renderAccessGroup(list, contacts) {
            const names = contacts.map(row => row.firstName || row.name || row.email);
            const emails = contacts.map(row => row.email).join(', ');
            const node = ce('div', list, {
                class: 'access-node access-group'
            });

            const avatars = ce('div', node, {class: 'access-group-avatars'});

            for (const row of contacts.slice(0, 2)) {
                if (row.handle && typeof MegaAvatarComponent !== 'undefined') {
                    MegaAvatarComponent.factory({
                        parentNode: ce('div', avatars, {class: 'access-avatar'}),
                        userHandle: row.handle,
                        size: 32
                    });
                }
            }

            // Show up to 3 names, then "and X others"
            const GROUP_NAME_LIMIT = 2;
            const label = names.length > GROUP_NAME_LIMIT
                ? mega.utils.trans.listToString(names, '%s others', false, GROUP_NAME_LIMIT)
                : mega.utils.trans.listToString(names, '%s', false);

            const info = ce('div', node, {class: 'access-info'});
            const nameNode = ce('div', info, {class: 'access-name'});

            ce('span', nameNode, {
                class: 'simpletip',
                'data-simpletip': emails,
                'data-simpletipposition': 'top'
            }).textContent = label;

            const showMore = ce('div', node, {class: 'access-group-more'});

            ce('span', showMore).textContent = l.share_full_list_btn;
            ce('i', showMore, {
                class: `${mega.ui.sprites.mono} icon-chevron-right-thin-outline`
            });

            node.addEventListener('click', () => this._setExpanded(true));
        }

        _changePermission(row, level) {
            if ($.addContactsToShare[row.handle]) {
                $.addContactsToShare[row.handle].r = level;
                return;
            }

            const shares = M.getOutShares(this.h, 'EXP') || {};

            if (!shares[row.handle] || shares[row.handle].r !== level) {
                $.changedPermissions[row.handle] = {
                    u: M.opc[row.handle] && M.opc[row.handle].m || row.handle,
                    r: level
                };
            }
            else {
                delete $.changedPermissions[row.handle];
            }

            this._updateSaveButton();
        }

        _removeAccess(row) {
            const added = $.addContactsToShare || {};
            const removed = $.removedContactsFromShare || {};
            const changed = $.changedPermissions || {};

            if (added[row.handle]) {
                delete added[row.handle];
            }
            else {
                removed[row.handle] = {
                    selectedNodeHandle: this.h,
                    userEmailOrHandle: M.opc[row.handle] && M.opc[row.handle].m
                        || (M.getUserByHandle(row.handle) || {}).m,
                    userHandle: row.handle
                };

                delete changed[row.handle];
            }

            $.addContactsToShare = added;
            $.removedContactsFromShare = removed;
            $.changedPermissions = changed;

            this.renderAccessList();
        }

        buildFooter() {
            const wrap = this.dom.footer = ce('div', null, {class: 'flex flex-row-reverse'});

            this.dom.shareBtn = new MegaButton({
                parentNode: wrap,
                text: l[60],
                componentClassname: 'slim',
                type: 'button'
            }).on('click.share', () => {
                // Fields are cleared / list re-rendered only on a successful share
                // (see _addContactsToShare); cancelling keeps the chips intact.
                this.invite();
            });

            this.dom.doneBtn = new MegaButton({
                parentNode: wrap,
                text: l[726],
                componentClassname: 'slim',
                type: 'button'
            }).on('click.done', () => {

                // Apply permission changes/removals from the access list  or close
                if (Object.keys($.changedPermissions || {}).length
                    || Object.keys($.removedContactsFromShare || {}).length) {

                    loadingDialog.show();
                    new mega.Share().updateNodeShares(this.h).finally(() => {
                        loadingDialog.hide();
                        this._close();
                        showToast('view', l.share_update_toast_success);
                    });
                }
                else {
                    this._close();
                }
            });

            this.dom.removeShare = new MegaLink({
                parentNode: wrap,
                text: l[23737],
                componentClassname: 'destructive font-600 underline',
                type: 'text'
            }).on('click.remove', () => {

                msgDialog(
                    `remove:!^${l.stop_folder_sharing_lbl}!${l.msg_dlg_cancel}`,
                    '',
                    l.remove_share_title, l.remove_share_msg,
                    res => {
                        if (res) {
                            loadingDialog.show();
                            new mega.Share().removeSharesFromSelected(this.h).always(() => {
                                loadingDialog.hide();
                                this._close();
                            });
                        }
                    },
                    1
                );
            });
        }
    }

    return freeze({

        data: Object.create(null),

        sheet,

        /**
         * Open the Share dialog e.g. mega.ui.mShareDialog.init(handle);
         * @param {String} selectedNode The selected node handle to be shared
         * @returns {void}
         */
        init(selectedNode) {

            const target = selectedNode;

            // Reset the share-mutation maps the invite flow writes into.
            $.addContactsToShare = {};
            $.changedPermissions = {};
            $.removedContactsFromShare = {};

            if (M.isInvalidUserStatus()) {
                return;
            }
            if (u_type === 0) {
                return ephemeralDialog(l[1006]); // Sharing folders is only for logged-in users
            }

            Promise.resolve(mega.fileRequestCommon.storage.isDropExist(target))
                .then((res) => {
                    if (res.length) {
                        return mega.fileRequest.showRemoveWarning(res, 'outshare');
                    }
                })
                .then(() => mega.keyMgr.setShareSnapshot(target))
                .then(() => !M.getSharingUsers(target).length && mega.sensitives.passShareCheck(target))
                .then(() => {
                    $.shareDialog = 'share';
                    this.data.dialog = new ShareDialog(target);
                    this.data.dialog.show();
                })
                .catch((ex) => {
                    if (ex !== EBLOCKED) {
                        // if it isn't a user-cancel from showRemoveWarning()
                        reportError(ex);
                    }
                });
        },

        /**
         * Render the content of the Access list in the Share dialog
         * @returns {void}
         */
        renderAccessList() {
            const {dialog} = mega.ui.mShareDialog.data;

            if (dialog && dialog.node) {
                dialog.renderAccessList();
            }
        },

        /**
         * Close dialog without calling closeDialog()
         * @returns {void}
         */
        hide() {
            sheet.trigger('close');
            sheet.hide();
        },
    });
});
