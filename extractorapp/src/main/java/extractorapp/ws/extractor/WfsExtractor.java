package extractorapp.ws.extractor;

import java.io.File;
import java.io.IOException;
import java.io.Serializable;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.geotools.data.DataStore;
import org.geotools.data.DataStoreFactorySpi;
import org.geotools.data.DefaultQuery;
import org.geotools.data.Query;
import org.geotools.data.wfs.WFSDataStoreFactory;
import org.geotools.factory.CommonFactoryFinder;
import org.geotools.factory.GeoTools;
import org.geotools.feature.FeatureCollection;
import org.geotools.geometry.jts.ReferencedEnvelope;
import org.geotools.referencing.CRS;
import org.geotools.util.NullProgressListener;
import org.opengis.feature.simple.SimpleFeature;
import org.opengis.feature.simple.SimpleFeatureType;
import org.opengis.feature.type.FeatureType;
import org.opengis.feature.type.GeometryDescriptor;
import org.opengis.feature.type.PropertyDescriptor;
import org.opengis.filter.FilterFactory2;
import org.opengis.filter.expression.Literal;
import org.opengis.filter.expression.PropertyName;
import org.opengis.filter.spatial.Intersects;
import org.opengis.referencing.FactoryException;
import org.opengis.referencing.crs.CoordinateReferenceSystem;
import org.opengis.referencing.operation.TransformException;
import org.opengis.util.ProgressListener;
import org.w3c.dom.NamedNodeMap;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import com.vividsolutions.jts.geom.Geometry;
import com.vividsolutions.jts.geom.GeometryCollection;
import com.vividsolutions.jts.geom.GeometryFactory;
import com.vividsolutions.jts.geom.LineString;
import com.vividsolutions.jts.geom.LinearRing;
import com.vividsolutions.jts.geom.MultiLineString;
import com.vividsolutions.jts.geom.MultiPoint;
import com.vividsolutions.jts.geom.MultiPolygon;
import com.vividsolutions.jts.geom.Point;
import com.vividsolutions.jts.geom.Polygon;

/**
 * Obtains data from a WFS and write the data out to the filesystem
 * 
 * @author jeichar
 */
public class WfsExtractor {

    /**
     * Enumerate general types of geometries we accept. Multi/normal is ignored
     * because shapefiles are always multigeom
     * 
     * The binding is the class to use when creating shapefile datastores
     * 
     * @author jeichar
     */
    enum GeomType {
        POINT (MultiPoint.class), LINE (MultiLineString.class), POLYGON (MultiPolygon.class), GEOMETRY (null);

        public final Class<?> binding;

        private GeomType (Class<?> binding) {
            this.binding = binding;
        }

        /**
         * Find the matching type from the geometry class
         */
        public static GeomType lookup (Class<?> binding) {
            GeomType result;
            if (Polygon.class.isAssignableFrom (binding) || MultiPolygon.class.isAssignableFrom (binding)) {
                result = POLYGON;
            } else if (LineString.class.isAssignableFrom (binding) || LinearRing.class.isAssignableFrom (binding)
                    || MultiLineString.class.isAssignableFrom (binding)) {
                result = LINE;
            } else if (Point.class.isAssignableFrom (binding) || MultiPoint.class.isAssignableFrom (binding)) {
                result = POINT;
            } else if (Geometry.class.isAssignableFrom (binding) || GeometryCollection.class.isAssignableFrom (binding)) {
                result = GEOMETRY;
            } else {
                throw new IllegalArgumentException (binding + " is not a recognized geometry type");
            }

            return result;
        }
    }

    private final File          _basedir;
    private final DataStoreFactorySpi _datastoreFactory;
    private final String _adminUsername;
    private final String _adminPassword;
    private final String _secureHost;

    /**
     * 
     * Should only be used by tests
     * 
     */
    public WfsExtractor (File basedir, DataStoreFactorySpi datastoreFactory) {
        this(basedir, datastoreFactory, "", "", "localhost");
    }

    /**
     * 
     * @param basedir
     *            the directory that the extracted files will be written in
     * @param datastoreFactory
     *            the datastore factory to use for connecting to the remote WFS.
     *            This is mainly to simplify testing
     * @param adminUsername username that give admin access to geoserver
     * @param adminPassword password the the admin user
     * @param secureHost 
     */
    public WfsExtractor (File basedir, DataStoreFactorySpi datastoreFactory, String adminUsername, String adminPassword, String secureHost) {
        this._basedir = basedir;
        this._datastoreFactory = datastoreFactory;
        this._adminPassword = adminPassword;
        this._adminUsername = adminUsername;
        this._secureHost = secureHost;
    }

    public void checkPermission(ExtractorLayerRequest request, String secureHost, String username, String roles) throws IOException {
        URL capabilitiesURL = request.capabilitiesURL("WFS", null);
        HttpURLConnection connection = (HttpURLConnection) capabilitiesURL.openConnection();
        if(secureHost.equalsIgnoreCase(request._url.getHost())
                || "127.0.0.1".equalsIgnoreCase(request._url.getHost())
                || "localhost".equalsIgnoreCase(request._url.getHost())) {
                    if(username != null) connection.addRequestProperty("sec-username", username);
                    if(roles != null) connection.addRequestProperty("sec-roles", roles);
        }
        
        String capabilities = FileUtils.asString(connection.getInputStream());

        NodeList featureTypes = XmlUtils.select("//wfs:FeatureType", capabilities, 
                XmlUtils.WFS_NAMESPACE_CONTEXT);

        for( int i=0; i < featureTypes.getLength(); i++) {
            Node type = featureTypes.item(i);
            
            if(request._namespace == null) {
                if(name(type).equals(request._layerName)) {
                    request.setWFSName(request._layerName);
                    return;
                }
            } else {
                if(correctNS(type, request)) {
                    if(namePart(type, request).equals(request._layerName)) {
                        request.setWFSName(name(type));
                        return;
                    }
                }
            }
        }
        
        throw new SecurityException("User does not have sufficient privileges to access the Layer: "+request._layerName);
    }

    private Object namePart(Node type, ExtractorLayerRequest request) {
        String name = name(type);
        final String[] parts = name.split(":",2);

        if(parts.length == 1){
            return parts[0];
        } else {
            return parts[1];
        }
    }

    private String name(Node type) {
        Node nameNode = type.getFirstChild();
        while(nameNode != null && !nameNode.getNodeName().equals("Name")) {
            nameNode = nameNode.getNextSibling();
        }
        String name = nameNode.getTextContent().trim();
        return name;
    }

    private boolean correctNS(Node type, ExtractorLayerRequest request) {
        NamedNodeMap atts = type.getAttributes();

        for( int j=0; j < atts.getLength(); j++) {
            Node item = atts.item(j);
            
            if(request._namespace.equals(item.getNodeValue())){
                return true;
            }
        }        
        return false;
    }

    /**
     * Extract the data as defined in the request object. Currently only supports export to shapefile
     * 
     * @return the location of the extracted data
     */
    public File[] extract (ExtractorLayerRequest request) throws IOException, TransformException, FactoryException {
        if (request._owsType != OWSType.WFS) {
            throw new IllegalArgumentException (request._owsType + "must be WFS for the WfsExtractor");
        }

        Map<String, Serializable> params = new HashMap<String, Serializable> ();
        params.put (WFSDataStoreFactory.URL.key, request.capabilitiesURL ("WFS","1.0.0"));
        params.put (WFSDataStoreFactory.LENIENT.key, true);
        params.put (WFSDataStoreFactory.PROTOCOL.key, true);

        
        // HACK  I want unrestricted access to layers. 
        // Security check takes place in ExtractorThread
        if(_secureHost.equalsIgnoreCase(request._url.getHost())
                || "127.0.0.1".equalsIgnoreCase(request._url.getHost())
                || "localhost".equalsIgnoreCase(request._url.getHost())) {
            params.put (WFSDataStoreFactory.USERNAME.key, _adminUsername);
            params.put (WFSDataStoreFactory.PASSWORD.key, _adminPassword);
        }
        
        DataStore sourceDs = _datastoreFactory.createDataStore (params);

        SimpleFeatureType sourceSchema = sourceDs.getSchema (request.getWFSName());
        
        Query query = createQuery (request, sourceSchema);
        FeatureCollection<SimpleFeatureType, SimpleFeature> features = sourceDs.getFeatureSource (request.getWFSName())
                .getFeatures (query);

        ProgressListener p = new NullProgressListener () {
            @Override
            public void exceptionOccurred (Throwable exception) {
                throw new RuntimeException (exception);
            }
        };
        CoordinateReferenceSystem requestProjection = request._projection;
        
        File basedir = request.createContainingDir(_basedir);
        
        basedir.mkdirs();

        DatastoreFactory dsFactory;
        if (request._format.equalsIgnoreCase("shp")) {
            dsFactory = new ShpDatastoreFactory();
        } else if (request._format.equalsIgnoreCase("mif")) {
            dsFactory = new MifDatastoreFactory();
        } else {
            throw new IllegalArgumentException(request._format + " is not a recognized vector format");
        }

        WriteFeatures writeFeatures = new WriteFeatures(sourceSchema, basedir, requestProjection,
                dsFactory);
        features.accepts(writeFeatures, p);

        writeFeatures.close();
        
        return writeFeatures.getShapeFiles ();
    }

    /* This method is default for testing purposes */
    Query createQuery (ExtractorLayerRequest request, FeatureType schema) throws IOException, TransformException,
            FactoryException {
        switch (request._owsType) {
        case WFS:
            
            // bbox may not be in the same projection as the data so it sometimes necessary to reproject the request BBOX
            ReferencedEnvelope bbox = request._bbox;
            if (schema.getCoordinateReferenceSystem () != null) {
                bbox = request._bbox.transform (schema.getCoordinateReferenceSystem (), true, 10);
            }
            
            FilterFactory2 filterFactory = CommonFactoryFinder.getFilterFactory2 (GeoTools.getDefaultHints ());
            String propertyName = schema.getGeometryDescriptor ().getLocalName ();
            PropertyName geomProperty = filterFactory.property (propertyName);
            Geometry bboxGeom = new GeometryFactory ().toGeometry (bbox);
            String epsgCode = "EPSG:"+CRS.lookupEpsgCode(bbox.getCoordinateReferenceSystem(),false);
            bboxGeom.setUserData(epsgCode);
            
            Literal geometry = filterFactory.literal (bboxGeom);
            Intersects filter = filterFactory.intersects (geomProperty, geometry);

            List<String> properties = new ArrayList<String> ();
            for (PropertyDescriptor desc : schema.getDescriptors ()) {
                if (desc instanceof GeometryDescriptor && desc != schema.getGeometryDescriptor ()) {
                    // shapefiles can only have one geometry so skip any
                    // geometry descriptor that is not the default
                    continue;
                } else {
                    properties.add (desc.getName ().getLocalPart ());
                }
            }

            String[] propArray = properties.toArray (new String[properties.size ()]);
            DefaultQuery query = new DefaultQuery (request.getWFSName(), filter, propArray);
            
            query.setCoordinateSystemReproject (request._projection);

            return query;
        default:
            return null;
        }
    }
}