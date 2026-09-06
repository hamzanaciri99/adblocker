// Storage keys, in one place.
//
// They are referenced from the background, the options page and the tests; a
// mismatched string literal between any two of those is a silent data loss bug.

export const SETTINGS_KEY = 'umbra:settings';
export const CUSTOM_FILTERS_KEY = 'umbra:customFilters';
