// "use client";

// import { useState } from "react";
// import Map, { Marker } from "react-map-gl";
// import "mapbox-gl/dist/mapbox-gl.css";

// export default function StravaCloudMap() {
//   const [viewport, setViewport] = useState({
//     latitude: 37.7749, // Default latitude (San Francisco)
//     longitude: -122.4194, // Default longitude (San Francisco)
//     zoom: 10, // Default zoom level
//   });

//   return (
//     <div className="min-h-screen bg-gray-100">
//       <div className="container mx-auto px-4 py-16">
//         <h1 className="text-4xl font-bold text-gray-800 mb-6">Strava Cloud Map</h1>
//         <p className="text-lg text-gray-700 mb-8">
//           Explore your Strava activity data on an interactive map.
//         </p>

//         {/* Mapbox Map */}
//         <div className="h-96">
//           <Map
//             initialViewState={viewport}
//             style={{ width: "100%", height: "100%" }}
//             mapStyle="mapbox://styles/mapbox/streets-v11"
//             mapboxAccessToken="YOUR_MAPBOX_ACCESS_TOKEN"
//             onMove={(evt) => setViewport(evt.viewState)}
//           >
//             {/* Example Marker */}
//             <Marker latitude={37.7749} longitude={-122.4194}>
//               <div
//                 style={{
//                   backgroundColor: "red",
//                   width: "10px",
//                   height: "10px",
//                   borderRadius: "50%",
//                 }}
//               />
//             </Marker>
//           </Map>
//         </div>
//       </div>
//     </div>
//   );
// }