/*requires knockout, knockout.mapping, knockout.validation, jquery, lodash*/
/*jslint nomen: true, vars: true*/
(function (root, factory) {
    'use strict';
    /*global define*/
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['exports', 'knockout', 'knockout-mapping', 'jquery', 'lodash'], factory);
    } else if (typeof exports === 'object') {
        // CommonJS
        factory(exports, require('knockout'), require('knockout-mapping'), require('jquery'), require('lodash'));
    } else {
        // Browser globals
        if (!root.ko || !root.ko.mapping || !root.$ || !root._) {
            throw new Error('knockout.js & knockout-mapping & jQuery & Lodash is required');
        }
        root.coverlet = {};
        factory(root.coverlet, root.ko, root.ko.mapping, root.$, root._);
    }
}(this, function (exports, ko, mapping, $, _) {
    'use strict';

    var Rest = (function () {
        function Class(url) {
            // http://jsperf.com/remove-last-char/2
            this.url = (url.indexOf('/') === (url.length - 1)) ?
                    url.substr(0, url.length - 1) :
                    url;
        }

        Class.prototype.get = function (id) {
            var that = this;
            return $.ajax({
                type: 'GET',
                url: that.url + (id ? '/' + id : ''),
                dataType: 'json'
            });
        };

        Class.prototype.post = function (item) {
            var that = this;
            return $.ajax({
                type: 'POST',
                url: that.url,
                dataType: 'json',
                contentType: 'application/json',
                data: mapping.toJS(item)
            });
        };

        Class.prototype.put = function (item) {
            var that = this;
            return $.ajax({
                type: 'PUT',
                url: that.url + '/' + item.id,
                dataType: 'json',
                contentType: 'application/json',
                data: mapping.toJS(item)
            });
        };

        Class.prototype.del = function (id) {
            var that = this;
            return $.ajax({
                type: 'DELETE',
                url: that.url + '/' + id,
                dataType: 'text'
            });
        };

        return Class;
    }());

    var RestStub = (function () {
        function Class(StubModel, collectionSize) {
            var that = this;
            that.StubModel = StubModel;
            that.data = _.times(collectionSize, function (i) {
                return new StubModel(i);
            });
        }

        Class.prototype.get = function (id) {
            var that = this;
            return $.when(_.clone(_.find(that.data, {'id': id}), true));
        };

        Class.prototype.post = function (item) {
            var that = this;
            item.id = item.id || (that.data[that.data.length - 1].id + 1);
            var clone = _.clone(item, true);
            that.data.push(clone);
            return $.when(clone);
        };

        Class.prototype.put = function (item) {
            var that = this;
            var clone = _.clone(item, true);
            that.data[_.findIndex(that.data, {'id': item.id})] = clone;
            return $.when(clone);
        };

        Class.prototype.del = function (id) {
            var that = this;
            _.remove(that.data, {'id': id});
            return $.when(true);
        };
        return Class;
    }());

    var LocalStorageRestDecorator = (function () {
        /*global localStorage*/
        function Class(base, key, TTL) {
            this.base = base;
            this.TTL = TTL;
            this.key = key;
        }

        function isLocalStorageSupports() {
            var test = '__test';
            try {
                localStorage.setItem(test, test);
                localStorage.removeItem(test);
                return true;
            } catch (e) {
                return false;
            }
        }

        if (!isLocalStorageSupports()) {
            return Class;
        }

        var fetch = function () {
            var that = this;
            return that.base.get()
                .then(function (newCollection) {
                    localStorage.setItem(that.key, JSON.stringify(newCollection));
                    localStorage.setItem(that.key + '_timeout', (new Date().getTime()) + that.TTL);
                    return newCollection;
                });
        };

        var fetchIfNotExist = function () {
            var that = this,
                cacheTimeout = JSON.parse(localStorage.getItem(that.key + '_timeout'));
            if (cacheTimeout < ((new Date().getTime()) + that.TTL)) {
                return $.when(fetch.call(that));
            }
            return $.when(JSON.parse(localStorage.getItem(that.key)));
        };

        Class.prototype.get = function (id) {
            var that = this;
            return fetchIfNotExist.call(that)
                .then(function (collection) {
                    if (typeof id === 'number') {
                        return _.find(collection, {'id': id});
                    }
                    return collection;
                });
        };
        Class.prototype.post = function (item) {
            var that = this;
            return that.base.post(item)
                .then(function (newItem) {
                    setTimeout(function () {
                        fetchIfNotExist.call(that)
                            .then(function (cache) {
                                cache.push(newItem);
                                localStorage.setItem(that.key, JSON.stringify(cache));
                            });
                    }, 0);
                    return newItem;
                });
        };
        Class.prototype.put = function (item) {
            var that = this;
            return that.base.put(item)
                .then(function (newItem) {
                    setTimeout(function () {
                        fetchIfNotExist.call(that)
                            .then(function (cache) {
                                var oldIndex = _.findIndex(cache, {'id': newItem.id});
                                cache[oldIndex] = newItem;
                                localStorage.setItem(that.key, JSON.stringify(cache));
                            });
                    }, 0);
                    return newItem;
                });
        };
        Class.prototype.del = function (id) {
            var that = this;
            return that.base.del(id)
                .then(function (data) {
                    setTimeout(function () {
                        fetchIfNotExist.call(that)
                            .then(function (cache) {
                                var oldIndex = _.findIndex(cache, {'id': id});
                                cache.splice(oldIndex, 1);
                                localStorage.setItem(that.key, JSON.stringify(cache));
                            });
                    }, 0);
                    return data;
                });
        };

        return Class;
    }());

    var CachedRestDecorator = (function () {
        function Class(base, TTL) {
            this.data = [];
            this.cacheTimeout = 0;
            this.base = base;
            this.TTL = TTL;
        }

        var fetch = function () {
            var that = this;
            return that.base.get()
                .then(function (newCollection) {
                    that.data = newCollection;
                    that.cacheTimeout = (new Date().getTime()) + that.TTL;
                    return newCollection;
                });
        };

        var fetchIfNotExist = function () {
            var that = this;
            return $.when(that.data || fetch.call(that));
        };

        Class.prototype.get = function (id) {
            var that = this;
            return fetchIfNotExist.call(that)
                .then(function (cache) {
                    if (typeof id === 'number') {
                        return _.find(cache, {'id': id});
                    }
                    return cache;
                });
        };

        Class.prototype.post = function (item) {
            var that = this;
            return that.base.post(item)
                .then(function (newItem) {
                    return fetchIfNotExist.call(that)
                        .then(function (cache) {
                            cache.push(newItem);
                            that.data = cache;
                            return newItem;
                        });
                });
        };

        Class.prototype.put = function (item) {
            var that = this;
            return that.base.put(item)
                .then(function (newItem) {
                    return fetchIfNotExist.call(that)
                        .then(function (cache) {
                            var oldIndex = _.findIndex(cache, {'id': newItem.id});
                            cache[oldIndex] = newItem;
                            that.data = cache;
                            return newItem;
                        });
                });
        };

        Class.prototype.del = function (id) {
            var that = this;
            return that.base.del(id)
                .then(function (data) {
                    return fetchIfNotExist.call(that)
                        .then(function (cache) {
                            var oldIndex = _.findIndex(cache, {'id': id});
                            cache.splice(oldIndex, 1);
                            that.data = cache;
                            return data;
                        });
                });
        };

        return Class;
    }());

    var Model = (function () {
        function Class(data, restClient, options) {
            var that = this;
            data = data || {};

            that.restClient = restClient;

            that.options = options || {};
            _.defaults(that.options, {
                id: null,
                indexes: null,
                immediateCommit: false,
                rateLimit: 200,
                validators: {}
            });

            that.model = mapping.fromJS(data);

            _.forOwn(options.validators, function (validator, key) {
                that.model[key] = that.model[key].extend(validator);
            });

            that.isValid = ko.computed(function () {
                return (!ko.validation.group(that.model)().length);
            });

            var lastValue = ko.observable(mapping.toJSON(that.model));
            that.isDirty = ko.computed({
                read: function () {
                    return mapping.toJSON(that.model) !== lastValue();
                },
                write: function (newValue) {
                    if (newValue) {
                        lastValue('');
                    } else {
                        lastValue(mapping.toJSON(that.model));
                    }
                }
            });
            that.isImmediateCommit = ko.observable(options.immediateCommit);
            ko.computed(function () {
                if (that.isImmediateCommit() && that.isDirty() && that.isValid()) {
                    that.commit();
                }
            }).extend({throttle: that.options.rateLimit});
        }

        Class.prototype.map = function (data) {
            var that = this;
            mapping.fromJS(data, that.model);
            that.isDirty(false);
            return that;
        };

        Class.prototype.commit = function (invalid) {
            var that = this;
            if (!invalid && !that.isValid()) {
                return $.Deffered().reject('model is invalid');
            }
            return that.restClient[that.model[that.options.id]() ? 'put' : 'post'](mapping.toJSON(that.model))
                .then(function (newData) {
                    if (newData) {
                        that.map(newData);
                    }
                    that.isDirty(false);
                    return that;
                });
        };

        Class.prototype.fetch = function () {
            var that = this;
            return that.restClient.get(that.model[that.options.id]())
                .then(function (data) {
                    that.map(data);
                    return that;
                });
        };

        Class.prototype.del = function () {
            var that = this;
            return that.restClient.del(that.model[that.options.id]())
                .then(function () {
                    that.model[that.options.id](null);
                });
        };

        return Class;
    }());

    var Collection = (function () {
        function Class(data, restClient, options) {
            var that = this;

            data = data || [];

            that.restClient = restClient;

            that.options = options || {};
            _.defaults(that.options, {
                id: null,
                indexes: null,
                immediateCommit: false,
                rateLimit: 200,
                validators: {}
            });

            that.collection = ko.observableArray(_.map(data, function (item) {
                return new Model(item, that.restClient, that.options);
            }));

            that.index = {};
            if (that.options.id) {
                that.index.id = ko.computed(function () {
                    return _.indexBy(that.collection(), function (item) {
                        var idProperty = item.model[that.options.id];
                        return idProperty && idProperty();
                    });
                });
            }

            function manyToManyMap(source, first, second) {
                return _.each(_.groupBy(source, first), function (group, key, collection) {
                    collection[key] = _.indexBy(group, second);
                });
            }

            _.forEach(that.options.indexes, function (index) {
                if (_.isArray(index) && index.length === 2) {
                    that.index[index[0] + ':' + index[1]] = ko.computed(function () {
                        return manyToManyMap(that.collection(), function (item) {
                            var indexProperty = item.model[index[0]];
                            return indexProperty && indexProperty();
                        }, function (item) {
                            var indexProperty = item.model[index[1]];
                            return indexProperty && indexProperty();
                        });
                    });
                } else {
                    that.index[index] = ko.computed(function () {
                        _.indexBy(that.collection(), function (item) {
                            var indexProperty = item.model[index];
                            return indexProperty && indexProperty();
                        });
                    });
                }
            });
        }

        Class.prototype.map = function (data) {
            var that = this;
            var toDelete = _.difference(_.keys(that.index.id()), _.pluck(data, that.options.id));
            _.forEach(toDelete, function (id) {
                that.collection.remove(that.index.id()[id]);
            });
            _.forEach(data, function (newItem) {
                var oldItem = that.index.id()[newItem[that.options.id]];
                if (!oldItem) {
                    that.collection.push(new Model(newItem, that.restClient, that.options));
                } else {
                    oldItem.map(newItem);
                }
            });
            return that;
        };

        Class.prototype.commit = function () {
            var that = this;
            _.forEach(that.collection(), function (item) {
                if (item.isDirty()) {
                    item.commit();
                }
            });
        };

        Class.prototype.fetch = function () {
            var that = this;
            return that.restClient.get()
                .then(function (newData) {
                    that.map(newData);
                    return that;
                });
        };

        Class.prototype.create = function (data) {
            var that = this;
            var newItem = new Model(data, that.restClient, that.options);
            that.collection.push(newItem);
            return newItem;
        };

        Class.prototype.del = function (id) {
            var that = this;
            if (!id) {
                throw new Error('"id" argument is required');
            }
            var item = that.index.id()[id];
            item.del();
            that.collection.remove(item);
            return item;
        };

        return Class;
    }());

    exports.Rest = Rest;
    exports.RestStub = RestStub;

    exports.LocalStorageRestDecorator = LocalStorageRestDecorator;
    exports.CachedRestDecorator = CachedRestDecorator;

    exports.Model = Model;
    exports.Collection = Collection;
}));