/*
 * Copyright (C) Camptocamp
 *
 * This file is part of geOrchestra
 *
 * geOrchestra is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with geOrchestra.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 * @include GEOR_config.js
 * @include GEOR_util.js
 * @include GeoExt/data/PrintProvider.js
 * @include GeoExt/data/PrintPage.js
 * @include GeoExt/plugins/PrintPageField.js
 * @include GeoExt/plugins/PrintProviderField.js
 * @include OpenLayers/Format/GeoJSON.js
 */

Ext.namespace("GEOR");

GEOR.print = (function() {

    /*
     * Private
     */

    /**
     * Property: mask
     * {Ext.LoadMask} The treePanel loadMask
     */
    var mask = null;

    /**
     * Property: win
     * {Ext.Window} The Ext window opened when the print
     * action triggers.
     */
    var win = null;

    /**
     * Property: action
     * {Ext.Action} The action.
     */
    var action = null;

    /**
     * Property: layerStore
     * {GeoExt.data.LayerStore} The layer store.
     */
    var layerStore = null;

    /**
     * Property: printProvider
     * {GeoExt.data.PrintProvider} The print provider.
     */
    var printProvider = null;

    /**
     * property: printpage
     * {geoext.data.printpage} The print page.
     */
    var printPage = null;

    /**
     * property: legendPanel
     * {GeoExt.LegendPanel} The legend panel.
     */
    var legendPanel = null;

    /**
     * Property: tr
     * {Function} an alias to OpenLayers.i18n
     */
    var tr = null;

    /**
     * property: defaultCustomParams
     * {Object} Default custom params for printPage.
     */
    var defaultCustomParams = {
        mapTitle: "",
        copyright: "",
        showOverview: true,
        showNorth: true,
        showScalebar: true,
        showDate: true,
        showLegend: true
    };

    /**
     * Method: getLayerSources
     * Creates an attribution string from map layers
     *
     * Parameters:
     * layerStore - {GeoExt.data.LayerStore} The application's layer store.
     *
     * Returns:
     * {String} The attribution string
     */
    var getLayerSources = function() {
        var attr = [];
        layerStore.each(function(r) {
            if (!r.get('attribution')) {
                return;
            }
            if (r.get('attribution').title && attr.indexOf(r.get('attribution').title) < 0) {
                attr.push(r.get('attribution').title);
            }
        });
        return ((attr.length > 1)?tr("Sources: "):tr("Source: ")) +attr.join(', ');
    };

    /**
     * Method: initialize
     *
     * Initialize the print module.
     *
     * Parameters:
     * layerStore - {GeoExt.data.LayerStore} The application's layer store.
     */
    var initialize = function(ls) {

        layerStore = ls;
        tr = OpenLayers.i18n;

        // The printProvider that connects us to the print service
        var r = GEOR.config.MAPFISHAPP_URL.split('/');
        r.pop(); // remove "edit" or latest "/" part
        var serviceUrl = r.join('/')+'/pdf';
        printProvider = new GeoExt.data.PrintProvider({
            url: serviceUrl,
            autoLoad: true,
            baseParams: {
                url: serviceUrl
            },
            listeners: {
                "loadcapabilities": function(provider, caps) {
                    // Filter out layouts from the provider.layouts store
                    // that the current user does not have the right to use:
                    // see http://applis-bretagne.fr/redmine/issues/4497
                    provider.layouts.filterBy(function(record) {
                        var layout = record.get('name'),
                            acl = GEOR.config.PRINT_LAYOUTS_ACL[layout];
                        // empty or not specified means "layout allowed for everyone"
                        if (!acl || acl.length === 0) {
                            return true;
                        }
                        for (var i=0, l=GEOR.config.ROLES.length; i<l; i++) {
                            // check current role is allowed to use current layout:
                            if (acl.indexOf(GEOR.config.ROLES[i]) >= 0) {
                                return true;
                            }
                        }
                        return false;
                    });
                    // create printPage:
                    printPage = new GeoExt.data.PrintPage({
                        printProvider: printProvider,
                        customParams: defaultCustomParams
                    });
                },
                "beforeencodelayer": function(layer) {
                    if ((layer.CLASS_NAME == "OpenLayers.Layer.Vector") ||
                        (layer.CLASS_NAME == "OpenLayers.Layer.Vector.RootContainer")) {
                        return false;
                    }
                },
                "beforeprint": function(pp) {
                    mask.show();
                    // closest matching print extent will be chosen:
                    printPage.fit(layerStore.map, {mode: "closest"});
                    // set a custom PDF file name:
                    pp.customParams.outputFilename = GEOR.config.PDF_FILENAME;
                },
                "print": function() {
                    mask.hide();
                },
                "printexception": function() {
                    mask.hide();
                    GEOR.util.errorDialog({
                        title: tr("Print error"),
                        msg: [
                            tr("Print server returned an error"),
                            tr("Contact platform administrator")
                        ].join('<br/>')
                    });
                },
                "encodelayer": function(pp, layer, encLayer) {
                    if (GEOR.config.WMSC2WMS.hasOwnProperty(layer.url)) {
                        if (GEOR.config.WMSC2WMS[layer.url] !== undefined) {
                            //console.log(layer.name + ' - tuilée avec WMS référencé'); // debug
                            encLayer.baseURL = GEOR.config.WMSC2WMS[layer.url];
                        } else {
                            //console.log(layer.name + ' - tuilée sans WMS référencé'); // debug
                            GEOR.util.infoDialog({
                                title: tr("Layer unavailable for printing"),
                                msg: [
                                    tr("The NAME layer cannot be printed.", {'NAME': layer.name}),
                                    tr("Contact platform administrator")
                                ].join('<br/>')
                            });
                        }
                    }
                }
            }
        });
    };

    var showWindow = function() {
        if (!printPage) {
            GEOR.util.errorDialog({
                title: tr("Unable to print"),
                msg: [
                    tr("The print server is currently unreachable"),
                    tr("Contact platform administrator")
                ].join('<br/>')
            });
            return;
        }
        if (win === null) {
            // default values from config:
            var r = printProvider.layouts.find("name",
                GEOR.config.DEFAULT_PRINT_LAYOUT);
            if (r >= 0) {
                printProvider.setLayout(printProvider.layouts.getAt(r));
            } else {
                alert(tr("print.unknown.layout",
                    {'LAYOUT': GEOR.config.DEFAULT_PRINT_LAYOUT}));
            }
            r = printProvider.dpis.find("value",
                GEOR.config.DEFAULT_PRINT_RESOLUTION);
            if (r >= 0) {
                printProvider.setDpi(printProvider.dpis.getAt(r));
            } else {
                alert(tr("print.unknown.resolution",
                    {'RESOLUTION': GEOR.config.DEFAULT_PRINT_RESOLUTION}));
            }
            // The form with fields controlling the print output
            var formPanel = new Ext.form.FormPanel({
                bodyStyle: "padding:5px",
                labelSeparator: tr("labelSeparator"),
                items: [{
                        xtype: 'textfield',
                        fieldLabel: tr("Title"),
                        width: 200,
                        name: 'mapTitle',
                        enableKeyEvents: true,
                        selectOnFocus: true,
                        plugins: new GeoExt.plugins.PrintPageField({
                            printPage: printPage
                        }),
                        listeners: {
                            "keypress": function(f, e) {
                                // transfer focus on Print button on ENTER
                                if (e.getKey() === e.ENTER) {
                                    win.getFooterToolbar().getComponent('print').focus();
                                }
                            }
                        }
                    }, {
                        xtype: 'hidden',
                        name: 'copyright',
                        plugins: new GeoExt.plugins.PrintPageField({
                            printPage: printPage
                        })
                    }, {
                        xtype: 'checkbox',
                        fieldLabel: tr("Minimap"),
                        name: 'showOverview',
                        checked: defaultCustomParams.showOverview,
                        plugins: new GeoExt.plugins.PrintPageField({
                            printPage: printPage
                        })
                    }, {
                        xtype: 'checkbox',
                        fieldLabel: tr("North"),
                        name: 'showNorth',
                        checked: defaultCustomParams.showNorth,
                        plugins: new GeoExt.plugins.PrintPageField({
                            printPage: printPage
                        })
                    }, {
                        xtype: 'checkbox',
                        fieldLabel: tr("Scale"),
                        name: 'showScalebar',
                        checked: defaultCustomParams.showScalebar,
                        plugins: new GeoExt.plugins.PrintPageField({
                            printPage: printPage
                        })

                    },{
                        xtype: 'checkbox',
                        fieldLabel: tr("Date"),
                        name: 'showDate',
                        checked: defaultCustomParams.showDate,
                        plugins: new GeoExt.plugins.PrintPageField({
                            printPage: printPage
                        })
                    }, {
                        xtype: 'checkbox',
                        fieldLabel: tr("Legend"),
                        name: 'showLegend',
                        checked: defaultCustomParams.showLegend,
                        plugins: new GeoExt.plugins.PrintPageField({
                            printPage: printPage
                        })
                    }, {
                        xtype: "combo",
                        store: printProvider.layouts,
                        lastQuery: '', // required to apply rights filter
                        displayField: "name",
                        valueField: "name",
                        fieldLabel: tr("Format"),
                        forceSelection: true,
                        editable: false,
                        mode: "local",
                        triggerAction: "all",
                        plugins: new GeoExt.plugins.PrintProviderField({
                            printProvider: printProvider
                        })
                    }, {
                        xtype: "combo",
                        store: printProvider.dpis,
                        displayField: "name",
                        valueField: "value",
                        fieldLabel: tr("Resolution"),
                        forceSelection: true,
                        editable: false,
                        tpl: '<tpl for="."><div class="x-combo-list-item">{name} dpi</div></tpl>',
                        mode: "local",
                        triggerAction: "all",
                        plugins: new GeoExt.plugins.PrintProviderField({
                            printProvider: printProvider
                        }),
                        // the plugin will work even if we modify a combo value
                        setValue: function(v){
                            var text = v;
                            if(this.valueField){
                                var r = this.findRecord(this.valueField, v);
                                if(r){
                                    text = r.data[this.displayField];
                                }
                            }
                            text = parseInt(v) + " dpi";
                            this.lastSelectionText = text;
                            Ext.form.ComboBox.superclass.setValue.call(this, text);
                            this.value = v;
                            return this;
                        }
                    }
                ]
            });

            win = new Ext.Window({
                title: tr("Print the map"),
                resizable: false,
                constrainHeader: true,
                animateTarget: GEOR.config.ANIMATE_WINDOWS && this.el,
                border: false,
                width: 350,
                autoHeight: true,
                closeAction: 'hide',
                items: [formPanel],
                listeners: {
                    "show": function() {
                        // focus first field on show
                        var field = formPanel.getForm().findField('mapTitle');
                        field.focus('', 50);
                    }
                },
                buttons: [{
                    text: tr("Close"),
                    handler: function() {
                        win.hide();
                    }
                }, {
                    text: tr("Print"),
                    minWidth: 90,
                    itemId: 'print',
                    iconCls: 'mf-print-action',
                    handler: function() {
                        printPage.customParams.copyright = getLayerSources();
                        printPage.fit(layerStore.map, false);
                        printProvider.print(layerStore.map, printPage, {
                            legend: legendPanel
                        });
                    }
                }]
            });
        }

        win.show();

        if (!mask) {
            mask = new Ext.LoadMask(win.bwrap.dom, {
                msg: tr("Printing...")
            });
        }
    };

    /*
     * Public
     */
    return {

        /**
         * APIMethod: init
         * Initialize the print module
         *
         * Parameters:
         * layerStore - {GeoExt.data.LayerStore} The application's layer store.
         */
        init: function(layerStore) {
            initialize(layerStore);
        },

        /**
         * APIMethod: getAction
         * Get the print action (for inclusion in a toolbar).
         *
         * Returns:
         * {Ext.Action} The action.
         */
        getAction: function() {
            if (action === null) {
                action = new Ext.Action({
                    iconCls: 'mf-print-action',
                    text: '',
                    tooltip: tr("Print current map"),
                    handler: showWindow
                });
            }
            return action;
        },

        /**
         * APIMethod: setLegend
         * Set the legend panel
         *
         * Parameters:
         * l - {GeoExt.LegendPanel} the legend panel
         */
        setLegend: function(l) {
            legendPanel = l;
        }
    };
})();
