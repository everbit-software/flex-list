import { ListItem } from "./list-item";
class FlexList {
    renderer;
    searcher;
    /*
     * Configuration (ID field, search config, columns, and sort)
     */
    // How the row is identified
    idField;
    // Sorting column
    sortColumn = null;
    // Sorting direction
    sortDirection = 'asc';
    // Text if there are no items
    noItemsText = 'No results found';
    /*
     * Available events
     *
     * itemsRendered    After an item has been rendered
     * pageChanged      After a page change
     * initialised      After the list is initialised
     */
    events = [];
    /*
     * Callbacks used to get list data
     */
    itemCallbacks = {};
    /*
     * Items
     */
    // Items (no search)
    items = [];
    // Current items in the search
    currentSearchItems = null;
    // The pages that have been pulled so far
    pages = [];
    /*
     * Pagination
     */
    pagination = {
        // Items per page
        perPage: 10,
        // The currently displayed page
        current: 1,
        // Minimum page number to display
        min: 1,
        // Maximum page number to display
        max: null,
        // The number of pages to show either side of the current page
        activePageRange: 1,
    };
    // Whether there is an error or not
    errorOccured = false;
    // The page URL (to update the query parameters
    url;
    constructor(config) {
        this.idField = config.idField;
        this.sortColumn = config.sortColumn ?? null;
        this.sortDirection = (config.sortDirection ?? 'asc').toLowerCase();
        this.renderer = config.renderer;
        this.searcher = config.search;
        if (config.noItemsText) {
            this.noItemsText = config.noItemsText;
        }
        // Pagination
        this.pagination.perPage = config.perPage ?? 10;
        this.itemCallbacks = config.itemCallbacks;
        this.init().then();
    }
    getItem(id) {
        const matchingItems = this.items.filter((item) => item.id === id);
        return matchingItems.length > 0 ? matchingItems.at(0) : undefined;
    }
    /**
     * Get the items on a given page
     *
     * @param page
     */
    async getPageItems(page) {
        if (!this.pages.includes(page)) {
            await this.pullPageItems(page);
        }
        return this.items.filter((item) => item.page === page);
    }
    /**
     * The items currently being displayed on the page
     */
    getCurrentItems() {
        if (this.searcher?.query) {
            return this.currentSearchItems ?? [];
        }
        else {
            return this.items.filter((item) => item.isDisplayed());
        }
    }
    /**
     * Clear the items being displayed
     */
    clearCurrentItems() {
        let items = this.getCurrentItems();
        for (let item of items) {
            item.element = null;
        }
        this.renderer.clearItems();
    }
    async pullPageItems(page, refreshIfExists = false) {
        // Pull a page, if the page hasn't been already
        if (!this.pages.includes(page) || refreshIfExists) {
            if (!this.pages.includes(page)) {
                this.pages.push(page);
            }
            let itemsObjects = await this.itemCallbacks.load(page, this.pagination.perPage);
            if (itemsObjects === false) {
                this.renderer.displayMessage('Data was unable to be retrieved, reload the page to try again.', true);
                return;
            }
            if (itemsObjects.length < this.pagination.perPage) {
                this.pagination.max = page;
            }
            for (let itemData of itemsObjects) {
                const id = itemData[this.idField];
                let item = this.getItem(id);
                // Just update the page if the item has already been added
                if (item !== undefined && (item.page === null || refreshIfExists)) {
                    // Update information
                    item.page = page;
                    item.data = itemData;
                }
                else {
                    item = new ListItem(itemData, id, page);
                    this.items.push(item);
                }
            }
        }
        if (this.errorOccured) {
            return;
        }
    }
    /**
     * Search using the remote search callback
     *
     * @param query
     * @param page
     * @private
     */
    async getcurrentSearchItems(query, page) {
        // Search by remote values
        let itemObjects = await this.itemCallbacks.search(query, this.pagination.current, this.pagination.perPage);
        if (itemObjects === false) {
            this.renderer.displayMessage('Your search returned an error, please try again', true);
            return [];
        }
        let items = [];
        for (let itemData of itemObjects) {
            items.push(new ListItem(itemData, itemData[this.idField], page));
        }
        return items;
    }
    /**
     *
     * @param items
     * @param append Whether to add to existing or overwrite
     * @private
     */
    renderItems(items, append = false) {
        if (!append) {
            this.clearCurrentItems();
        }
        for (let item of items) {
            if (!append && item.isDisplayed()) {
                continue;
            }
            item.element = this.renderer.createItemElement(item);
            this.renderer.addItemToContainer(item);
        }
        this.triggerEvent('itemsRendered', {
            items: items
        });
    }
    /**
     * Refresh an item element by item ID or item object
     *
     * @param item
     * @returns {Promise<void>}
     */
    async refreshItem(item) {
        if (!this.itemCallbacks.loadOne) {
            return;
        }
        item = item instanceof ListItem ? item : this.getItem(item);
        await this.renderer.showItemSpinner(item);
        // Pull the row
        item.data = await this.itemCallbacks.loadOne(item.id);
        // Replace the displayed item
        let newElement = this.renderer.createItemElement(item);
        item.element.replaceWith(newElement);
        item.element = newElement;
        this.triggerEvent('itemRefreshed', {
            item: item
        });
    }
    /**
     * Change the page from a page number (this includes search queries)
     *
     * @param page
     * @param showSpinner
     */
    async changePage(page, showSpinner = true) {
        // Update the page to be in the correct bounds
        if (this.pagination.max && page > this.pagination.max) {
            page = this.pagination.max;
        }
        else if (page < this.pagination.min) {
            page = this.pagination.min;
        }
        // Get the page change type
        let pageChange = 'refresh-only';
        if (this.pagination.current < page) {
            pageChange = 'next';
        }
        else if (this.pagination.current > page) {
            pageChange = 'prev';
        }
        // Show spinner
        if (showSpinner) {
            this.renderer.toggleSpinner(true);
        }
        // Get previous page
        let previousPage = this.pagination.current;
        this.pagination.current = page;
        let pageItems;
        if (this.searcher?.query) {
            pageItems = await this.getcurrentSearchItems(this.searcher.query, page);
            this.currentSearchItems = pageItems;
        }
        else {
            pageItems = await this.getPageItems(page);
            this.currentSearchItems = null;
        }
        // Return if there is an error getting items
        if (this.errorOccured) {
            return;
        }
        // If no items, go to previous page (if it's not the same page as that would an infinite loop)
        if (pageItems.length === 0 && previousPage !== page && this.pagination.current !== 1) {
            if (pageChange === 'next') {
                this.pagination.max = previousPage;
            }
            this.changePage(previousPage).then();
            return;
        }
        // Order items
        if (this.sortColumn !== null) {
            pageItems = pageItems.sort((a, b) => {
                return a.data[this.sortColumn].toString().localeCompare(b.data[this.sortColumn].toString());
            });
            if (this.sortDirection !== 'asc') {
                pageItems.reverse();
            }
        }
        this.setQueryParam('page', page.toString());
        if (showSpinner) {
            this.renderer.toggleSpinner(false);
        }
        if (pageItems.length === 0) {
            if (this.searcher?.query) {
                this.renderer.displayMessage(`No results found for <span class="badge bg-light">${this.searcher.query}</span>`, false);
            }
            else {
                this.renderer.displayMessage(this.noItemsText, false);
            }
        }
        else {
            this.renderItems(pageItems);
        }
        // this.renderer.scrollIntoView();
        if (this.renderer.paginationElements?.pagesContainer) {
            this.updatePagination();
        }
        this.triggerEvent(this.searcher?.query ? 'search' : 'pageChanged', {
            page: page,
            pageItems: pageItems,
            query: this.searcher?.query,
            changeType: pageChange
        });
    }
    async clearSearch() {
        if (!this.searcher) {
            return;
        }
        this.renderer.toggleSpinner(false);
        this.searcher.inputElement.value = '';
        this.deleteQueryParam(this.searcher.queryParam);
        this.searcher.query = null;
        await this.changePage(1);
    }
    async search(query) {
        if (!this.searcher || this.searcher.query === query) {
            this.renderer.toggleSpinner(false);
            return;
        }
        this.pagination.current = 1;
        this.searcher.query = query;
        if (!query) {
            await this.clearSearch();
            return;
        }
        this.searcher.inputElement.value = query;
        this.setQueryParam(this.searcher.queryParam, query);
        await this.changePage(this.pagination.current, false);
        this.renderer.toggleSpinner(false);
    }
    /**
     * Deletes all remotes data and retrieves the current page
     */
    async clearData() {
        this.clearCurrentItems();
        this.items = [];
        this.pages = [];
        await this.changePage(this.pagination.current);
    }
    updateUrl() {
        let url = this.url.toString();
        window.history.pushState({ path: url }, '', url);
    }
    getQueryParam(name) {
        return this.url.searchParams.get(name);
    }
    hasQueryParam(name) {
        return this.url.searchParams.has(name);
    }
    setQueryParam(name, value) {
        this.url.searchParams.set(name, value);
        this.updateUrl();
    }
    deleteQueryParam(name) {
        this.url.searchParams.delete(name);
        this.updateUrl();
    }
    previous() {
        let newPage = this.pagination.current - 1;
        if (newPage < this.pagination.min) {
            newPage = this.pagination.min;
        }
        this.changePage(newPage).then();
    }
    ;
    next() {
        let newPage = this.pagination.current + 1;
        if (this.pagination.max !== null && newPage > this.pagination.max) {
            newPage = this.pagination.max;
        }
        this.changePage(newPage).then();
    }
    ;
    updatePagination() {
        if (!this.renderer.paginationElements) {
            return;
        }
        let pagesContainer = this.renderer.paginationElements.pagesContainer;
        let selectedPage = this.pagination.current;
        let inBetweenPages = [];
        let showPagination = true;
        if (this.getCurrentItems().length === 0) {
            showPagination = false;
        }
        else if (this.pagination.min && this.pagination.max && Math.abs(this.pagination.max - this.pagination.min) <= 5) {
            // If there are less than 5 pages
            for (let p = this.pagination.min; p <= this.pagination.max; p++) {
                inBetweenPages.push(p);
            }
        }
        else if (this.pagination.min && this.pagination.current <= this.pagination.min + this.pagination.activePageRange) {
            // First few pages
            for (let p = this.pagination.min; p <= this.pagination.min + (this.pagination.activePageRange * 2); p++) {
                inBetweenPages.push(p);
            }
        }
        else if (this.pagination.max && this.pagination.current >= this.pagination.max - this.pagination.activePageRange) {
            // Last few pages
            for (let p = this.pagination.max - (this.pagination.activePageRange * 2); p <= this.pagination.max; p++) {
                inBetweenPages.push(p);
            }
        }
        else if (this.pagination.min && this.pagination.max) {
            // Middle pages (if known max)
            for (let p = selectedPage - this.pagination.activePageRange; p <= selectedPage + this.pagination.activePageRange && this.pagination.min <= p && p <= this.pagination.max; p++) {
                inBetweenPages.push(p);
            }
        }
        else {
            // Middle pages (if max is not known)
            for (let p = selectedPage - this.pagination.activePageRange; p <= selectedPage + this.pagination.activePageRange && this.pagination.min <= p; p++) {
                inBetweenPages.push(p);
            }
        }
        const paginationStyle = this.renderer.style.paginationStyle;
        console.log(paginationStyle);
        let appendPage = (page, content = null, isDisabled = false, isActive = null) => {
            // Placeholder page
            if (page === null) {
                isDisabled = true;
                isActive = false;
                content = '...';
            }
            else {
                isActive = isActive ?? (!isDisabled && selectedPage == page);
                content = page.toString();
            }
            // Button
            let button = document.createElement('button');
            button.type = 'button';
            console.log(...paginationStyle.pageClasses, ...(isActive ? paginationStyle.pageSelectedClasses : paginationStyle.pageDeselectedClasses));
            button.classList.add(...paginationStyle.pageClasses, ...(isActive ? paginationStyle.pageSelectedClasses : paginationStyle.pageDeselectedClasses));
            button.disabled = isDisabled;
            button.innerHTML = content ?? '';
            pagesContainer.append(button);
            if (!isDisabled && page) {
                button.onclick = () => this.changePage(page);
            }
        };
        pagesContainer.innerHTML = '';
        pagesContainer.className = paginationStyle.pagesContainerClasses.join(' ');
        if (!showPagination) {
            return;
        }
        if (this.pagination.min && !inBetweenPages.includes(this.pagination.min)) {
            appendPage(this.pagination.min);
            appendPage(null); // Add placeholder
        }
        for (let p of inBetweenPages) {
            appendPage(p);
        }
        if (this.pagination.max && !inBetweenPages.includes(this.pagination.max)) {
            appendPage(null); // Add placeholder
            appendPage(this.pagination.max);
        }
    }
    changeRenderer(renderer) {
        this.renderer = renderer;
        this.init();
    }
    /**
     * Trigger an event
     *
     * @param eventName
     * @param data
     * @private
     */
    triggerEvent(eventName, data = {}) {
        const events = this.events[eventName] ?? [];
        for (const evt of events) {
            evt(data, this);
        }
    }
    /**
     * Add an event
     *
     * @param eventName
     * @param callback
     * @private
     */
    addEventListener(eventName, callback) {
        if (this.events[eventName] === undefined) {
            this.events[eventName] = [];
        }
        this.events[eventName].push(callback);
    }
    async init() {
        // Get query parameters
        this.url = new URL(window.location.href);
        this.renderer.setup();
        // Add spinner
        this.renderer.setupSpinner();
        this.renderer.toggleSpinner(true);
        // Get current page
        if (this.hasQueryParam('page')) {
            this.pagination.current = parseInt(this.getQueryParam('page'));
        }
        // Get the per page limit
        if (this.hasQueryParam('limit')) {
            this.pagination.perPage = parseInt(this.getQueryParam('limit'));
        }
        // Search
        if (this.searcher && this.searcher.fields.length > 0) {
            let searchTimer;
            this.searcher.query = this.getQueryParam(this.searcher.queryParam);
            if (this.searcher.query) {
                this.searcher.inputElement.value = this.searcher.query;
            }
            // Search change event listener
            this.searcher?.inputElement.addEventListener('input', () => {
                this.renderer.toggleSpinner(true);
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => this.searcher && this.search(this.searcher.inputElement.value), this.searcher?.searchDelay);
            });
        }
        // Get the last page number
        if (this.itemCallbacks.getLastPageNumber !== undefined) {
            const lastPage = await this.itemCallbacks.getLastPageNumber();
            if (lastPage !== false) {
                this.pagination.max = lastPage;
            }
        }
        // Render init items
        this.changePage(this.pagination.current).then(async () => {
            this.renderer.toggleSpinner(false);
            // If no items, change to the first page
            if (this.getCurrentItems().length === 0) {
                await this.changePage(this.pagination.min);
            }
        });
        /*
         * Setup pagination
         */
        // Change page
        if (this.renderer.paginationElements?.prevButton) {
            this.renderer.paginationElements.prevButton.onclick = () => this.previous();
        }
        if (this.renderer.paginationElements?.nextButton) {
            this.renderer.paginationElements.nextButton.onclick = () => this.next();
        }
        this.triggerEvent('initialised');
    }
}
export default FlexList;
//# sourceMappingURL=flex-list.js.map