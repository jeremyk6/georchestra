/**
 * Sample geOrchestra catlogapp config file
 *
 * Instructions: 
 * uncomment lines you wish to modify and 
 * modify the corresponding values to suit your needs.
 */

Ext.namespace("GEOR");

GEOR.custom = {

    /**
     * Constant: GEONETWORK_URL
     * The URL to the GeoNetwork server.
     * Defaults to "/geonetwork/srv/fre"
     */
    GEONETWORK_URL: "http://localhost:8080/geonetwork/srv/fre",

    /**
     * Constant: VIEWER_URL
     * The URL to Mapfishapp
     * Defaults to "/mapfishapp/"
     */
    VIEWER_URL: "http://localhost:8080/mapfishapp/",
        
    /**
     * Constant: EXTRACTOR_URL
     * The URL to Extractorapp
     * Defaults to "/extractorapp/"
     */
    EXTRACTOR_URL: "http://localhost:8080/extractorapp/"
    
    /**
     * Constant: MAP_DOTS_PER_INCH
     * {Float} Sets the resolution used for scale computation.
     * Defaults to GeoServer defaults, which is 25.4 / 0.28
     */
    //,MAP_DOTS_PER_INCH: 25.4 / 0.28
    
    // No trailing comma for the last line (or IE will complain)
}